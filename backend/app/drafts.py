"""Reviewing Claude's draft of a posting's resume or cover letter (docs/APP_FLOW.md, "Tailoring a
posting's document"; docs/FRONTEND_CHECKS.md, "Claude's suggestions").

Starting a posting's document with Claude (start_draft) stores Claude's suggestion in its
`draft`, with each piece of Claude's text (a rewording or new narrative content or bullet) kept
once in `texts` and pointed to by key from where it's placed. The user's first pass edits the
draft's tree: removing, reordering, adding what the library lists there, and going back to an
item's original wording. Each change is checked (check_sections) and saved in the draft, so
nothing reaches the document or the library until the review is finished.

Finishing (finish) saves each of Claude's texts the user kept as a new library row, listed right
after the original (or, for new text, under the section, role, or project Claude put it in), and
the tree with those rows in place of the originals, used in this document only. Any of Claude's
texts the user didn't use is kept in the library the same way only if the user asks.
"""

from typing import Any, Literal

import anthropic
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.documents import EntryKind, Kind
from app.errors import AppError, ErrorCode
from app.library import append
from app.models import (
    BulletPoint,
    ExperienceBulletPoint,
    NarrativeContent,
    ProjectBulletPoint,
    SectionBulletPoint,
    SectionNarrativeContent,
)
from app.routers import bullet_points, narrative_content
from app.routers.bullet_points import BulletIn
from app.routers.narrative_content import NarrativeIn
from app.suggestions import (
    SuggestedBullet,
    SuggestedEntry,
    SuggestedSection,
    Suggestion,
    load_library,
    suggest,
    usable,
)
from app.versions import shown_name

# Claude's reason is empty for what the user added during the review.


class DraftBullet(BaseModel):
    bullet_id: int | None
    # Claude's wording (a key in Draft.texts), or None for the bullet as written.
    text_key: int | None = None
    # Back to the bullet's own wording instead of Claude's.
    use_original: bool = False
    reason: str = ""


class DraftEntry(BaseModel):
    kind: EntryKind
    # None only for Claude's new narrative content or bullet.
    item_id: int | None
    text_key: int | None = None
    use_original: bool = False
    reason: str = ""
    skill_ids: list[int] = []
    bullets: list[DraftBullet] = []


class DraftSection(BaseModel):
    section_id: int
    reason: str = ""
    entries: list[DraftEntry] = []


class ClaudeText(BaseModel):
    """A rewording or new text Claude wrote, and where it goes in the library if it's kept."""

    key: int
    kind: Literal["narrative", "bullet"]
    text: str
    # The item it rewords, or None for new text.
    replaces: int | None
    # Where Claude placed it: its section, and for a bullet under a role or project, that item.
    section_id: int
    parent_kind: Literal["experience", "project"] | None = None
    parent_id: int | None = None


class StartingDocument(BaseModel):
    id: int
    name: str


class Draft(BaseModel):
    starting_document: StartingDocument | None
    starting_reason: str
    texts: list[ClaudeText]
    sections: list[DraftSection]


class DraftSections(BaseModel):
    sections: list[DraftSection]


class FinishIn(BaseModel):
    # The keys of Claude's texts the user didn't use but wants kept in the library.
    keep: list[int] = []


def to_draft(suggestion: Suggestion, starting: StartingDocument | None) -> Draft:
    """The checked suggestion as a draft, with each of Claude's texts kept once by key."""
    texts: list[ClaudeText] = []

    def keep(kind: Literal["narrative", "bullet"], text: str | None, replaces: int | None,
             section_id: int, parent: SuggestedEntry | None = None) -> int | None:
        if text is None:
            return None
        texts.append(ClaudeText(
            key=len(texts) + 1, kind=kind, text=text, replaces=replaces, section_id=section_id,
            parent_kind=parent.kind if parent else None,
            parent_id=parent.item_id if parent else None))
        return len(texts)

    sections = [DraftSection(section_id=section.section_id, reason=section.reason, entries=[
        DraftEntry(
            kind=entry.kind, item_id=entry.item_id, reason=entry.reason,
            text_key=(keep(entry.kind, entry.new_text, entry.item_id, section.section_id)
                      if entry.kind in ("narrative", "bullet") else None),
            skill_ids=entry.skill_ids,
            bullets=[DraftBullet(bullet_id=bullet.bullet_id, reason=bullet.reason,
                                 text_key=keep("bullet", bullet.new_text, bullet.bullet_id,
                                               section.section_id, entry))
                     for bullet in entry.bullets])
        for entry in section.entries]) for section in suggestion.sections]
    return Draft(starting_document=starting, starting_reason=suggestion.starting_reason,
                 texts=texts, sections=sections)


def start_draft(db: Session, client: anthropic.Anthropic, kind: Kind, account_id: int,
                doc: Any) -> None:
    """Claude's suggestion for a new posting's document, stored in its draft."""
    suggestion = suggest(db, client, kind, account_id, doc)
    starting = None
    if suggestion.starting_document_id is not None:
        pk = getattr(kind.doc, kind.doc_id)
        name = db.scalar(select(shown_name(kind.doc)).where(
            pk == suggestion.starting_document_id))
        starting = StartingDocument(id=suggestion.starting_document_id, name=name)
    doc.draft = to_draft(suggestion, starting).model_dump()
    db.flush()


def current_draft(doc: Any) -> Draft:
    if doc.draft is None:
        raise AppError(ErrorCode.VALIDATION_FAILED, "There's no draft from Claude to review.")
    return Draft.model_validate(doc.draft)


def _refuse(message: str) -> AppError:
    return AppError(ErrorCode.VALIDATION_FAILED, message, field="sections")


def check_sections(db: Session, account_id: int, draft: Draft,
                   sections: list[DraftSection]) -> None:
    """Refuse a reviewed tree that Claude's suggestion couldn't have held: an id that isn't the
    account's own or is hidden, a skill or bullet its item doesn't list, a bullet twice in a
    section (as in suggestions.usable), or Claude's text anywhere but where Claude put it, and
    each piece of it once. The user's own changes come from what the library lists, so only a
    library changed since the page read it gets here."""
    texts = {text.key: text for text in draft.texts}
    used: set[int] = set()

    def text_of(key: int | None, kind: str, item_id: int | None, use_original: bool) -> str | None:
        if key is None:
            raise _refuse("Only Claude's new text can be placed without a saved item.")
        text = texts.get(key)
        if text is None or text.kind != kind or text.replaces != item_id or key in used:
            raise _refuse("Claude's text can only stay where Claude put it.")
        if use_original and item_id is None:
            raise _refuse("New text from Claude has no original to go back to.")
        used.add(key)
        return text.text

    suggestion = Suggestion(starting_document_id=None, starting_reason="", sections=[
        SuggestedSection(section_id=section.section_id, reason="", entries=[
            SuggestedEntry(
                kind=entry.kind, item_id=entry.item_id, reason="", skill_ids=entry.skill_ids,
                new_text=(text_of(entry.text_key, entry.kind, entry.item_id, entry.use_original)
                          if entry.text_key is not None or entry.item_id is None else None),
                bullets=[SuggestedBullet(
                    bullet_id=bullet.bullet_id, reason="",
                    new_text=(text_of(bullet.text_key, "bullet", bullet.bullet_id,
                                      bullet.use_original)
                              if bullet.text_key is not None or bullet.bullet_id is None
                              else None))
                    for bullet in entry.bullets])
            for entry in section.entries])
        for section in sections])
    dropped = usable(suggestion, load_library(db, account_id), set())[1]
    if dropped:
        raise _refuse("Something in the draft can't go where it is anymore: "
                      f"{', '.join(dropped)}. Read the page again to see the library as it is.")


def in_use(sections: list[DraftSection]) -> set[int]:
    """The keys of Claude's texts the reviewed tree uses (not gone back to the original)."""
    keys = set()
    for section in sections:
        for entry in section.entries:
            if entry.text_key is not None and not entry.use_original:
                keys.add(entry.text_key)
            keys |= {bullet.text_key for bullet in entry.bullets
                     if bullet.text_key is not None and not bullet.use_original}
    return keys


def _save_text(db: Session, account_id: int, text: ClaudeText) -> int:
    """A new library row with Claude's text: right after the original wherever it's listed, or
    for new text, listed under the role, project, or section Claude put it in."""
    if text.kind == "bullet":
        if text.replaces is not None:
            original = db.get(BulletPoint, text.replaces)
            return bullet_points.new_version(db, original, BulletIn(content=text.text),
                                             account_id).bullet_id
        row = BulletPoint(account_id=account_id, content=text.text)
        db.add(row)
        db.flush()
        if text.parent_kind == "experience":
            append(db, ExperienceBulletPoint, "experience_id", text.parent_id, "bullet_id",
                   row.bullet_id)
        elif text.parent_kind == "project":
            append(db, ProjectBulletPoint, "project_id", text.parent_id, "bullet_id",
                   row.bullet_id)
        else:
            append(db, SectionBulletPoint, "section_id", text.section_id, "bullet_id",
                   row.bullet_id)
        return row.bullet_id
    if text.replaces is not None:
        original = db.get(NarrativeContent, text.replaces)
        return narrative_content.new_version(db, original, NarrativeIn(content=text.text),
                                             account_id).content_id
    row = NarrativeContent(account_id=account_id, content=text.text)
    db.add(row)
    db.flush()
    append(db, SectionNarrativeContent, "section_id", text.section_id, "content_id",
           row.content_id)
    return row.content_id


def finish(db: Session, account_id: int, draft: Draft, keep: list[int]) -> list[dict[str, Any]]:
    """Save Claude's texts the user kept (in the tree, or from the ones it didn't use, `keep`)
    as new library rows, and return the tree to place, with those rows in place of the
    originals (as document_tree.RestoredTree's sections)."""
    check_sections(db, account_id, draft, draft.sections)
    used = in_use(draft.sections)
    unused = {text.key for text in draft.texts} - used
    if not set(keep) <= unused:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Only Claude's text you didn't use can be kept for later.", field="keep")
    saved = {text.key: _save_text(db, account_id, text)
             for text in draft.texts if text.key in used or text.key in keep}

    def placed_id(item_id: int | None, key: int | None, use_original: bool) -> int:
        return saved[key] if key is not None and not use_original else item_id

    return [{"section_id": section.section_id, "entries": [
        {"kind": entry.kind,
         "item_id": placed_id(entry.item_id, entry.text_key, entry.use_original),
         "skill_ids": entry.skill_ids,
         "bullet_ids": [placed_id(bullet.bullet_id, bullet.text_key, bullet.use_original)
                        for bullet in entry.bullets]}
        for entry in section.entries]} for section in draft.sections]
