"""The chat with Claude beside a resume or cover letter (app/chat.py), under /{doc_id}/chat.

GET reads the conversation; POST sends a message and streams Claude's reply as JSON lines.
The checks that refuse a message (a sent document, a draft still to review, an empty or long
message, or what it's about not in the document) run before the stream starts, so they come
back as ordinary error responses. A proposal in Claude's reply is applied (an ordinary change
to the tree, app/proposals.py), which sets aside earlier ones for the same content (stale), or
dismissed, and dismissing can be taken back. A reply whose
writing check failed can be checked again. Every message returned marks its proposals still
waiting that would take the document past its pages (app/proposals.py, page_marks), against the
document as it is then.
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
from app.flag_dismissal import FlagChoice, set_dismissed
from app.models import ChatMessage, ChatRole
from app.proposals import (
    apply,
    find_proposal,
    mark_stale,
    page_marks,
    set_aside_gone,
    set_state,
)
from app.rule_proposals import RuleApplyIn, RuleProposal, apply_rule

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
        doc = get_owned(db, kind.doc, doc_id, account_id)
        turns = history(db, kind, doc_id)
        # Cards about what's been taken out of the document since are set aside first.
        set_aside_gone(db, kind, doc, turns)
        mark = page_marks(db, kind, account_id, doc)
        return [message_out(turn, mark) for turn in turns]

    @router.post("/{doc_id}/chat")
    def send_message(doc_id: int, body: ChatIn, db: StreamSession, account_id: StreamAccountId,
                     client: Claude) -> Any:
        doc = get_owned(db, kind.doc, doc_id, account_id)
        text, about, replying = start(db, kind, account_id, doc, body)
        return StreamingResponse(
            reply(db, client, kind, account_id, doc, text, about, replying,
                  marks=lambda: page_marks(db, kind, account_id, doc)),
            media_type="application/x-ndjson")

    @router.post("/{doc_id}/chat/{message_id}/proposals/{proposal_id}/apply")
    def apply_proposal(doc_id: int, message_id: int, proposal_id: str, db: DbSession,
                       account_id: AccountId,
                       body: RuleApplyIn | None = None) -> dict[str, Any]:
        """Make the proposed change to the document, or to a rule (with the user's choices in
        the body, app/rule_proposals.py), and mark it applied, setting aside the earlier ones
        still pending for the same content (stale, app/proposals.py). Returns the document's
        detail, the message with the proposal's new state, the other messages that changed
        (`updated`), how many proposals went stale (`stale`), and for a rule, what applying it
        did (`notice`)."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        index, proposal = find_proposal(message, proposal_id)
        if proposal.state != "pending":
            raise AppError(ErrorCode.VALIDATION_FAILED, "That change was already "
                           f"{proposal.state}.")
        notice = None
        if isinstance(proposal, RuleProposal):
            notice = apply_rule(db, kind, account_id, doc, proposal, body or RuleApplyIn())
        else:
            apply(db, kind, account_id, doc, proposal)
        set_state(message, index, "applied")
        updated, stale = mark_stale(history(db, kind, doc_id), message, index)
        db.flush()
        db.refresh(doc)
        mark = page_marks(db, kind, account_id, doc)
        return {"document": detail(db, doc), "message": message_out(message, mark),
                "updated": [message_out(turn, mark) for turn in updated], "stale": stale,
                "notice": notice}

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
        return message_out(message, page_marks(db, kind, account_id, doc))

    @router.put("/{doc_id}/chat/{message_id}/proposals/{proposal_id}")
    def set_proposal_state(doc_id: int, message_id: int, proposal_id: str,
                           body: ProposalStateIn, db: DbSession,
                           account_id: AccountId) -> ChatMessageOut:
        """Dismiss a proposal, or take that back (pending). An applied one stays applied: the
        page's Undo takes back the change itself. A stale one can be taken back (pending), not
        dismissed."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        index, proposal = find_proposal(message, proposal_id)
        if proposal.state == "applied" or (proposal.state == "stale"
                                           and body.state == "dismissed"):
            raise AppError(ErrorCode.VALIDATION_FAILED,
                           f"That change was already {proposal.state}.")
        set_state(message, index, body.state)
        db.flush()
        return message_out(message, page_marks(db, kind, account_id, doc))

    @router.put("/{doc_id}/chat/{message_id}/proposals/{proposal_id}/flags")
    def set_proposal_flag_dismissed(doc_id: int, message_id: int, proposal_id: str,
                                    body: FlagChoice, db: DbSession,
                                    account_id: AccountId) -> ChatMessageOut:
        """Dismiss one of a proposal's writing flags, or restore it (app/flag_dismissal.py).
        Only the flag changes; a kept proposal's text takes its flags as they are then."""
        doc = get_owned(db, kind.doc, doc_id, account_id)
        check_open(db, kind, doc)
        message = own_message(db, doc_id, message_id)
        index, _ = find_proposal(message, proposal_id)
        # A new list, so the JSONB column sees the change.
        proposals = [dict(stored) for stored in message.proposals]
        proposals[index]["flags"] = set_dismissed(proposals[index].get("flags"), body)
        message.proposals = proposals
        db.flush()
        return message_out(message, page_marks(db, kind, account_id, doc))
