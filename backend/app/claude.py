"""Claude requests (docs/TECH_STACK.md, "AI integration").

Every Claude call goes through here, so the model, error handling, and usage logging are the
same for each step. The API key stays on the server: only the backend reads it (from
backend/.env), and the front end only ever talks to FastAPI.

Each step is one request with a structured response (`ask`): the reply's shape is a Pydantic
model, which the SDK checks, so the app gets data it can use directly instead of text to pick
apart. The chat's turns are text and tool calls instead (`converse`).
Every request streams, so a long one (a whole resume, at high effort) never hits an HTTP
timeout, and the app waits for the whole reply.
"""

import logging
from collections.abc import Callable, Generator
from functools import lru_cache
from typing import Annotated, Any, Literal

import anthropic
from fastapi import Depends, Request
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# Room for a step's thinking and reply (a long job description copied word for word). A step
# with a longer reply passes its own.
MAX_TOKENS = 16000

Effort = Literal["low", "medium", "high", "xhigh", "max"]


@lru_cache
def get_client() -> anthropic.Anthropic:
    key = get_settings().anthropic_api_key
    if not key:
        raise AppError(ErrorCode.AI_UNAVAILABLE,
                       "Add your Anthropic API key to backend/.env, then restart the backend.")
    # The SDK retries rate limits, server errors, and lost connections twice on its own.
    return anthropic.Anthropic(api_key=key)


# Tests swap in a stand-in client through FastAPI's dependency overrides.
Claude = Annotated[anthropic.Anthropic, Depends(get_client)]


def later_client(request: Request) -> Callable[[], anthropic.Anthropic]:
    """get_client, called only if the request turns out to need Claude: saving the user's own
    text runs the writing check, which asks Claude only when there's a rule to check, and a save
    never fails for want of a key. A test's stand-in (its dependency override) is used too."""
    return request.app.dependency_overrides.get(get_client, get_client)


ClaudeLater = Annotated[Callable[[], anthropic.Anthropic], Depends(later_client)]


def ask[T: BaseModel](client: anthropic.Anthropic, *, step: str,
                      system: str | list[dict[str, Any]], content: str | list[dict[str, Any]],
                      reply: type[T],
                      effort: Effort, max_tokens: int = MAX_TOKENS) -> T:
    """One request for one step, returning the reply as `reply`. `system` is the instructions,
    or a list of text blocks, where one marked with cache_control caches everything up to it.
    `content` is the user message: text, or a list of blocks (a PDF and the text about it).
    Any failure, after the SDK's own retries, is AI_UNAVAILABLE (docs/API_ERRORS.md), and the
    user's work is kept."""
    try:
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            # Opus 5.5 always thinks; effort sets how much (lower for simple steps).
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            output_format=reply,
            # If a safety check declines the request, the API runs it again on the model
            # Anthropic recommends for that case, inside the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            response = stream.get_final_message()
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
        raise AppError(ErrorCode.AI_UNAVAILABLE,
                       "Claude didn't accept the API key. Check it in backend/.env, then "
                       "restart the backend.") from error
    except (anthropic.APIError, ValidationError) as error:
        raise AppError(ErrorCode.AI_UNAVAILABLE) from error
    # Logged for the cost check (docs/BUILD_PLAN.md, phase 5).
    logger.info("Claude %s: %s", step, response.usage)
    if response.stop_reason != "end_turn" or response.parsed_output is None:
        raise AppError(ErrorCode.AI_UNAVAILABLE) from RuntimeError(
            f"{step} stopped with {response.stop_reason}")
    return response.parsed_output


def reply_text(content: list[dict[str, Any]]) -> str:
    """What the person reads of a reply (stored content blocks): its text blocks and the text
    of its progress-update thinking blocks, in order, each trimmed, a blank line between
    them. Reasoning blocks are empty under `display: "updates"`, so they add nothing."""
    parts = [(block.get("text") if block.get("type") == "text" else block.get("thinking")
              if block.get("type") == "thinking" else "") or "" for block in content]
    return "\n\n".join(part.strip() for part in parts if part.strip())


def converse(client: anthropic.Anthropic, *, step: str, system: list[dict[str, Any]],
             messages: list[dict[str, Any]], tools: list[dict[str, Any]], effort: Effort,
             max_tokens: int = MAX_TOKENS) -> Generator[str, None, Any]:
    """One turn of a conversation, for the chat (app/chat.py): yields Claude's reply text as
    it's written, and returns the whole message (its content blocks, with any tool calls).
    Claude may end its turn calling tools; nothing here runs them. Failures are
    AI_UNAVAILABLE, as in `ask`.

    What Claude writes to the person before a tool call comes back as a progress-update
    thinking block, not a text block (on Claude Opus 5.5, anything longer than a sentence or
    two), so the reply is its text blocks and its progress updates, in order (reply_text).
    With `display: "updates"` the updates have text and the reasoning blocks stay empty."""
    try:
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            # Each thinking block is bound to the system prompt, tools, and messages it was
            # written after. The chat only appends to its history (its rules come in the
            # messages), but its system prompt holds the instructions and the posting, so editing
            # either mid-conversation makes the saved blocks stop matching.
            # The API then drops them instead of refusing the request; Claude still reads every
            # message, and thinks again where its old reasoning is gone.
            thinking={"type": "adaptive", "display": "updates",
                      "block_binding": {"prefix_mismatch_behavior": "drop_block"}},
            output_config={"effort": effort},
            betas=["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01",
                   "thinking-display-updates-2026-08-18"],
            fallbacks="default",
        ) as stream:
            # Each block's text as it streams, with a blank line between blocks.
            last_block: int | None = None
            for event in stream:
                if event.type != "content_block_delta":
                    continue
                piece = (event.delta.text if event.delta.type == "text_delta"
                         else event.delta.thinking if event.delta.type == "thinking_delta"
                         else "")
                if not piece:
                    continue
                if last_block is not None and event.index != last_block:
                    yield "\n\n"
                last_block = event.index
                yield piece
            response = stream.get_final_message()
        dropped = [item for item in getattr(response, "input_transformations", None) or []
                   if getattr(item, "type", None) == "thinking_dropped"]
        if dropped:
            logger.info("Claude %s: dropped %d earlier thinking blocks (%s)", step, len(dropped),
                        ", ".join(sorted({str(getattr(item, "reason", "")) for item in dropped})))
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
        raise AppError(ErrorCode.AI_UNAVAILABLE,
                       "Claude didn't accept the API key. Check it in backend/.env, then "
                       "restart the backend.") from error
    except anthropic.APIError as error:
        raise AppError(ErrorCode.AI_UNAVAILABLE) from error
    logger.info("Claude %s: %s", step, response.usage)
    # A reply cut short (max_tokens) or declined (refusal) is never kept.
    if response.stop_reason not in ("end_turn", "tool_use"):
        raise AppError(ErrorCode.AI_UNAVAILABLE) from RuntimeError(
            f"{step} stopped with {response.stop_reason}")
    return response
