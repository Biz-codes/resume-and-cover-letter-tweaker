"""Narrative content: the text of summaries and cover letter paragraphs, and the sections that
list each excerpt. An excerpt can be anything from one sentence to a full paragraph; a summary or
paragraph combines the excerpts the user picks, in order.

Like bullets, an excerpt is stored once and can be listed under any number of sections. A resume
or cover letter stores only which excerpts it picked (resume_narrative_content,
cover_letter_narrative_content), so editing its text follows "Changing an item" in
docs/FRONTEND_CHECKS.md:
- Sent versions never change.
- Resumes and cover letters in progress change only if the user picks them (apply_to). If
  every one is picked and no sent version uses the excerpt, it's edited in place.
- Otherwise the new text is saved as a new excerpt, listed right after the original in its
  sections, and only the picked ones switch to it.

Creating or editing an excerpt can also choose every section that lists it. Those lists only
drive suggestions, so changing them never makes a new excerpt; when a text edit does, the
sections chosen apply to the new excerpt, and the original keeps its own.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.hiding import HiddenIn, refuse_delete_if_sent, set_hidden
from app.library import check_ids, list_beside, set_parents
from app.models import NarrativeContent, Section, SectionNarrativeContent
from app.refs import SectionRef, section_refs
from app.schemas import RequiredText
from app.usage import NARRATIVE_LINKS, DocRef, Use, edit_choice, switch_unsent, uses

router = APIRouter(prefix="/api/narrative-content", tags=["narrative content"])


class NarrativeIn(BaseModel):
    content: RequiredText()


class NewNarrative(NarrativeIn):
    # The sections that list the new excerpt (last in each). With none, it starts unlisted.
    section_ids: list[int] = []


class NarrativeEdit(NarrativeIn):
    # Every section that lists the excerpt after the edit. None leaves its sections as they are.
    section_ids: list[int] | None = None
    # The resumes and cover letters in progress the user checked to get a change to the text.
    apply_to: list[DocRef] = []


class NarrativeOut(NarrativeIn):
    content_id: int
    hidden: bool
    sections: list[SectionRef]
    used_by: list[Use]


def to_out(db: Session, excerpts: list[NarrativeContent]) -> list[NarrativeOut]:
    ids = [excerpt.content_id for excerpt in excerpts]
    sections = section_refs(db, SectionNarrativeContent, "content_id", ids)
    used_by = uses(db, NARRATIVE_LINKS, ids)
    return [NarrativeOut(content_id=excerpt.content_id,
                         hidden=excerpt.hidden, content=excerpt.content,
                         sections=sections[excerpt.content_id],
                         used_by=used_by[excerpt.content_id])
            for excerpt in excerpts]


def one_out(db: Session, excerpt: NarrativeContent) -> NarrativeOut:
    return to_out(db, [excerpt])[0]


def check_sections(db: Session, section_ids: list[int], account_id: int) -> None:
    check_ids(db, Section, Section.id, section_ids, account_id, "section_ids",
              allow_built_in=True)


def list_under(db: Session, excerpt: NarrativeContent, section_ids: list[int]) -> None:
    set_parents(db, SectionNarrativeContent, "section_id", "content_id", excerpt.content_id,
                section_ids)


def new_version(db: Session, original: NarrativeContent, body: NarrativeIn,
                account_id: int) -> NarrativeContent:
    """A new excerpt with this text, listed right after the original in its sections."""
    version = NarrativeContent(account_id=account_id, content=body.content)
    db.add(version)
    db.flush()
    list_beside(db, SectionNarrativeContent, "section_id", "content_id", original.content_id,
                version.content_id)
    return version


@router.get("")
def list_narrative(db: DbSession, account_id: AccountId) -> list[NarrativeOut]:
    """Oldest first."""
    excerpts = db.scalars(select(NarrativeContent)
                        .where(NarrativeContent.account_id == account_id)
                        .order_by(NarrativeContent.content_id)).all()
    return to_out(db, list(excerpts))


@router.get("/{content_id}")
def get_one(content_id: int, db: DbSession, account_id: AccountId) -> NarrativeOut:
    return one_out(db, get_owned(db, NarrativeContent, content_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_narrative(body: NewNarrative, db: DbSession, account_id: AccountId) -> NarrativeOut:
    check_sections(db, body.section_ids, account_id)
    excerpt = NarrativeContent(account_id=account_id, content=body.content)
    db.add(excerpt)
    db.flush()
    list_under(db, excerpt, body.section_ids)
    return one_out(db, excerpt)


@router.put("/{content_id}")
def update_narrative(content_id: int, body: NarrativeEdit, db: DbSession,
                     account_id: AccountId) -> NarrativeOut:
    """Changes the excerpt's text and sections (see the module docstring for when the text
    is saved as a new excerpt).

    The response's content_id differs from the one in the url when a new excerpt was saved.
    """
    excerpt = get_owned(db, NarrativeContent, content_id, account_id)
    if body.section_ids is not None:
        check_sections(db, body.section_ids, account_id)
    saved = excerpt
    if excerpt.content != body.content:
        in_place, chosen = edit_choice(
            uses(db, NARRATIVE_LINKS, [content_id])[content_id], body.apply_to)
        if in_place:
            excerpt.content = body.content
        else:
            saved = new_version(db, excerpt, body, account_id)
            if chosen:
                switch_unsent(db, NARRATIVE_LINKS, content_id, saved.content_id, only=chosen)
    if body.section_ids is not None:
        list_under(db, saved, body.section_ids)
    db.flush()
    db.refresh(saved)
    return one_out(db, saved)


@router.put("/{content_id}/hidden")
def set_narrative_content_hidden(content_id: int, body: HiddenIn, db: DbSession,
                                 account_id: AccountId) -> NarrativeOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"). Nothing that uses it changes."""
    item = get_owned(db, NarrativeContent, content_id, account_id)
    set_hidden(db, item, body.hidden)
    return one_out(db, item)


@router.delete("/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_narrative(content_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it from every section, resume, and cover letter."""
    item = get_owned(db, NarrativeContent, content_id, account_id)
    refuse_delete_if_sent(uses(db, NARRATIVE_LINKS, [content_id])[content_id], "narrative content")
    db.delete(item)
