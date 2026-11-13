"""The chat with Claude beside a resume or cover letter (app/chat.py), under /{doc_id}/chat.

GET reads the conversation; POST sends a message and streams Claude's reply as JSON lines.
The checks that refuse a message (a sent document, a draft still to review, an empty or long
message, or what it's about not in the document) run before the stream starts, so they come
back as ordinary error responses. A proposal in Claude's reply is applied (an ordinary change
to the tree, app/proposals.py) or dismissed, and dismissing can be taken back. A reply whose
writing check failed can be checked again.
"""

from collections.abc import Callable
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.account import AccountId, current_account_id, get_owned
from app.chat import (
    ChatIn,
    ChatMessageOut,
    check_open,
    history,
    message_out,
    recheck,
    reply,
    start,
)
from app.claude import Claude
from app.db import DbSession, get_db
from app.documents import Kind
from app.errors import AppError, ErrorCode
from app.models import ChatMessage, ChatRole
from app.proposals import apply, find_proposal, set_state

# The session stays open until the stream ends ("request" scope), so the reply's two turns
# are saved in the same transaction as the checks before it.
StreamSession = Annotated[Session, Depends(get_db, scope="request")]


def stream_account_id(db: StreamSession) -> int:
    """The current account, read with the same session, so the request has only one."""
    return current_account_id(db)


StreamAccountId = Annotated[int, Depends(stream_account_id)]


class ProposalStateIn(BaseModel):
    state: Literal["pending", "dismissed"]


def add_chat_routes(router: APIRouter, kind: Kind, detail: Callable[[Session, Any], Any]) -> None:
    def own_message(db: Session, doc_id: int, message_id: int) -> ChatMessage:
        message = db.get(ChatMessage, message_id)
        column = "resume_id" if kind.prefix == "resume" else "letter_id"
        if message is None or getattr(message, column) != doc_id:
            raise AppError(ErrorCode.NOT_FOUND)
        return message

    @router.get("/{doc_id}/chat")
    def read_chat(doc_id: int, db: DbSession, account_id: AccountId) -> list[ChatMessageOut]:
        get_owned(db, kind.doc, doc_id, account_id)
        return [message_out(turn) for turn in history(db, kind, doc_id)]

    @router.post("/{doc_id}/chat")
    def send_message(doc_id: int, body: ChatIn, db: StreamSession, account_id: StreamAccountId,
                     client: Claude) -> Any:
        doc = get_owned(db, kind.doc, doc_id, account_id)
        text, about = start(db, kind, account_id, doc, body)
        return StreamingResponse(reply(db, client, kind, account_id, doc, text, about),
                                 media_type="application/x-ndjson")

    @router.post("/{doc_id}/chat/{message_id}/proposals/{proposal_id}/apply")
    def apply_proposal(doc_id: int, message_id: int, proposal_id: str, db: DbSession,
                       account_id: AccountId) -> dict[str, Any]:
        """Make the proposed change to the document, and mark it applied. Returns the
        document's detail and the message with the proposal's new state."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        index, proposal = find_proposal(message, proposal_id)
        if proposal.state != "pending":
            raise AppError(ErrorCode.VALIDATION_FAILED, "That change was already "
                           f"{proposal.state}.")
        apply(db, kind, account_id, doc, proposal)
        set_state(message, index, "applied")
        db.flush()
        db.refresh(doc)
        return {"document": detail(db, doc), "message": message_out(message)}

    @router.post("/{doc_id}/chat/{message_id}/check")
    def check_message(doc_id: int, message_id: int, db: DbSession, account_id: AccountId,
                      client: Claude) -> ChatMessageOut:
        """Check the reply's proposals against the writing rules again, after the check failed
        (app/chat.py, recheck). Returns the message with what the check found."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        if message.role != ChatRole.assistant:
            raise AppError(ErrorCode.NOT_FOUND)
        recheck(db, client, account_id, doc, message)
        db.flush()
        return message_out(message)

    @router.put("/{doc_id}/chat/{message_id}/proposals/{proposal_id}")
    def set_proposal_state(doc_id: int, message_id: int, proposal_id: str,
                           body: ProposalStateIn, db: DbSession,
                           account_id: AccountId) -> ChatMessageOut:
        """Dismiss a proposal, or take that back (pending). An applied one stays applied: the
        page's Undo takes back the change itself."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        index, proposal = find_proposal(message, proposal_id)
        if proposal.state == "applied":
            raise AppError(ErrorCode.VALIDATION_FAILED, "That change was already applied.")
        set_state(message, index, body.state)
        db.flush()
        return message_out(message)
