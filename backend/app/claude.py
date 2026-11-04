"""Claude requests (docs/TECH_STACK.md, "AI integration").

Every Claude call goes through here, so the model, error handling, and usage logging are the
same for each step. The API key stays on the server: only the backend reads it (from
backend/.env), and the front end only ever talks to FastAPI.

Each step is one request with a structured response: the reply's shape is a Pydantic model,
which the SDK checks, so the app gets data it can use directly instead of text to pick apart.
"""

import logging
from functools import lru_cache
from typing import Annotated, Literal

import anthropic
from fastapi import Depends
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# Room for the longest reply a step gives (a long job description copied word for word).
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


def ask[T: BaseModel](client: anthropic.Anthropic, *, step: str, system: str, content: str,
                      reply: type[T], effort: Effort) -> T:
    """One request for one step, returning the reply as `reply`. Any failure, after the SDK's
    own retries, is AI_UNAVAILABLE (docs/API_ERRORS.md), and the user's work is kept."""
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
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
        )
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
