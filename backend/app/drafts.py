"""Reviewing Claude's draft of a posting's resume or cover letter (docs/APP_FLOW.md, "Tailoring a
posting's document"; docs/FRONTEND_CHECKS.md, "Claude's suggestions").

Starting a posting's document with Claude (start_draft) stores Claude's suggestion in its
`draft`, with each piece of Claude's text (a rewording or new narrative content or bullet) kept
once in `texts` and pointed to by key from where it's placed. The user's first pass only
accepts or rejects Claude's suggestions: rejecting what Claude brought in or wrote, and going
back to an item's original wording (or to Claude's again). Each change is checked
(check_sections) and saved in the draft, so nothing reaches the document or the library until
the review is finished.

A cover letter's draft can also hold new sections Claude titled for its new paragraphs (each
once in `new_sections`, pointed to by key) and the greeting Claude suggests, which the user keeps
or swaps for the letter's usual one.

Finishing (finish) saves each of Claude's texts the user kept as a new library row, listed right
after the original (or, for new text, under the section, role, or project Claude put it in), and
the tree with those rows in place of the originals, used in this document only. A skill shown
under a category or project that doesn't list it yet is listed there in the library, as on the
page. Any of Claude's
texts the user didn't use is kept in the library the same way only if the user asks. Claude's
new sections the draft still has are added to the library first (or the saved one with the same
title is used).
"""

from typing import Any, Literal

import anthropic
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.documents import EntryKind, Kind
from app.errors import AppError, ErrorCode
from app.library import append
from app.models import (
    BulletPoint,
    ExperienceBulletPoint,
    NarrativeContent,
    ProjectBulletPoint,
    ProjectSkill,
    Section,
    SectionBulletPoint,
    SectionNarrativeContent,
    SkillCategorySkill,
)
from app.routers import bullet_points, narrative_content
from app.routers.bullet_points import BulletIn
from app.routers.narrative_content import NarrativeIn
from app.suggestions import (
    LetterSection,
    LetterSuggestion,
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
    # None for a new section Claude titled (new_key, a key in Draft.new_sections).
    section_id: int | None
    new_key: int | None = None
    reason: str = ""
    entries: list[DraftEntry] = []


class ClaudeText(BaseModel):
    """A rewording or new text Claude wrote, and where it goes in the library if it's kept."""

    key: int
    kind: Literal["narrative", "bullet"]
    text: str
    # The item it rewords, or None for new text.
    replaces: int | None
    # Where Claude placed it: its section (or the key of Claude's new section), and for a bullet
    # under a role or project, that item.
    section_id: int | None
    section_key: int | None = None
    parent_kind: Literal["experience", "project"] | None = None
    parent_id: int | None = None


class ClaudeSection(BaseModel):
    """A new section Claude titled for a cover letter's new paragraph."""

    key: int
    title: str


class DraftGreeting(BaseModel):
    """The greeting Claude suggests for a cover letter (its addressee), and whether the user
    keeps the letter's usual one instead."""

    addressee: str
    reason: str
    use_default: bool = False


class StartingDocument(BaseModel):
    id: int
    name: str


class Draft(BaseModel):
    starting_document: StartingDocument | None
    starting_reason: str
    texts: list[ClaudeText]
    sections: list[DraftSection]
    new_sections: list[ClaudeSection] = []
    greeting: DraftGreeting | None = None


class DraftSections(BaseModel):
    sections: list[DraftSection]
    # The letter's usual greeting instead of Claude's (ignored without one).
    use_default_greeting: bool = False


class FinishIn(BaseModel):
    # The keys of Claude's texts the user didn't use but wants kept in the library.
    keep: list[int] = []


def to_draft(suggestion: Suggestion, starting: StartingDocument | None,
             addressee: str | None = None) -> Draft:
    """The checked suggestion as a draft, with each of Claude's texts and new sections kept
    once by key. `addressee` is the letter's own greeting, which Claude's replaces only when
    it differs."""
    texts: list[ClaudeText] = []
    new_sections: list[ClaudeSection] = []

    def keep(kind: Literal["narrative", "bullet"], text: str | None, replaces: int | None,
             place: DraftSection, parent: SuggestedEntry | None = None) -> int | None:
        if text is None:
            return None
        texts.append(ClaudeText(
            key=len(texts) + 1, kind=kind, text=text, replaces=replaces,
            section_id=place.section_id, section_key=place.new_key,
            parent_kind=parent.kind if parent else None,
            parent_id=parent.item_id if parent else None))
        return len(texts)

    sections: list[DraftSection] = []
    for section in suggestion.sections:
        place = DraftSection(section_id=section.section_id, reason=section.reason)
        if isinstance(section, LetterSection) and section.section_id == 0:
            new_sections.append(ClaudeSection(key=len(new_sections) + 1,
                                              title=section.new_title))
            place = DraftSection(section_id=None, new_key=len(new_sections),
                                 reason=section.reason)
        place.entries = [DraftEntry(
            kind=entry.kind, item_id=entry.item_id, reason=entry.reason,
            text_key=(keep(entry.kind, entry.new_text, entry.item_id, place)
                      if entry.kind in ("narrative", "bullet") else None),
            skill_ids=entry.skill_ids,
            bullets=[DraftBullet(bullet_id=bullet.bullet_id, reason=bullet.reason,
                                 text_key=keep("bullet", bullet.new_text, bullet.bullet_id,
                                               place, entry))
                     for bullet in entry.bullets])
            for entry in section.entries]
        sections.append(place)
    greeting = None
    if (isinstance(suggestion, LetterSuggestion) and suggestion.addressee
            and suggestion.addressee.lower() != (addressee or "").strip().lower()):
        greeting = DraftGreeting(addressee=suggestion.addressee,
                                 reason=suggestion.addressee_reason)
    return Draft(starting_document=starting, starting_reason=suggestion.starting_reason,
                 texts=texts, sections=sections, new_sections=new_sections, greeting=greeting)


def start_draft(db: Session, client: anthropic.Anthropic, kind: Kind, account_id: int,
                doc: Any, start_from: int | None = None) -> None:
    """Claude's suggestion for a new posting's document, stored in its draft. With
    `start_from`, Claude starts from that document (see suggestions.suggest). When that's the
    document's own tree, the finished review replaces it, so there's no other document it's
    based on."""
    suggestion = suggest(db, client, kind, account_id, doc, start_from)
    starting = None
    if suggestion.starting_document_id not in (None, getattr(doc, kind.doc_id)):
        pk = getattr(kind.doc, kind.doc_id)
        name = db.scalar(select(shown_name(kind.doc)).where(
            pk == suggestion.starting_document_id))
        starting = StartingDocument(id=suggestion.starting_document_id, name=name)
    doc.draft = to_draft(suggestion, starting, getattr(doc, "addressee", None)).model_dump()
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
    account's own or is hidden, a bullet its item doesn't list, a bullet twice in a
    section (as in suggestions.usable), or Claude's text anywhere but where Claude put it, and
    each piece of it once, and Claude's new sections once each. The user's own changes come
    from what the library lists, so only a library changed since the page read it gets here."""
    texts = {text.key: text for text in draft.texts}
    used: set[int] = set()
    titles = {new.key: new.title for new in draft.new_sections}
    used_sections: set[int] = set()

    def section_of(section: DraftSection, entries: list[SuggestedEntry]) -> SuggestedSection:
        if section.section_id is not None:
            return SuggestedSection(section_id=section.section_id, reason="", entries=entries)
        if section.new_key not in titles or section.new_key in used_sections:
            raise _refuse("Claude's new sections can each be in the draft once.")
        used_sections.add(section.new_key)
        return LetterSection(section_id=0, new_title=titles[section.new_key], reason="",
                             entries=entries)

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
        section_of(section, [
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


def _save_text(db: Session, account_id: int, text: ClaudeText,
               new_sections: dict[int, int]) -> int:
    """A new library row with Claude's text: right after the original wherever it's listed, or
    for new text, listed under the role, project, or section Claude put it in (`new_sections`:
    the ids Claude's new sections were saved as, by key). New text in a new section the user
    rejected stands alone."""
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
    section_id = (text.section_id if text.section_key is None
                  else new_sections.get(text.section_key))
    if section_id is not None:
        append(db, SectionNarrativeContent, "section_id", section_id, "content_id",
               row.content_id)
    return row.content_id


def _save_sections(db: Session, account_id: int, draft: Draft) -> dict[int, int]:
    """Claude's new sections the draft still has, added to the library (or the saved one with
    the same title, hidden ones too, since titles are unique ignoring capitals), by key."""
    titles = {new.key: new.title for new in draft.new_sections}
    saved: dict[int, int] = {}
    for section in draft.sections:
        if section.new_key is None:
            continue
        title = titles[section.new_key]
        section_id = db.scalar(select(Section.id).where(
            func.lower(Section.title) == title.lower(),
            or_(Section.account_id == account_id, Section.account_id.is_(None))).limit(1))
        if section_id is None:
            row = Section(account_id=account_id, title=title)
            db.add(row)
            db.flush()
            section_id = row.id
        saved[section.new_key] = section_id
    return saved


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
    new_sections = _save_sections(db, account_id, draft)
    saved = {text.key: _save_text(db, account_id, text, new_sections)
             for text in draft.texts if text.key in used or text.key in keep}

    # Skills Claude put under a category or project that doesn't list them yet, listed last.
    for section in draft.sections:
        for entry in section.entries:
            if entry.kind in ("category", "project"):
                link, column = ((SkillCategorySkill, "category_id") if entry.kind == "category"
                                else (ProjectSkill, "project_id"))
                for skill_id in entry.skill_ids:
                    append(db, link, column, entry.item_id, "skill_id", skill_id)

    def placed_id(item_id: int | None, key: int | None, use_original: bool) -> int:
        return saved[key] if key is not None and not use_original else item_id

    return [{"section_id": (section.section_id if section.new_key is None
                            else new_sections[section.new_key]), "entries": [
        {"kind": entry.kind,
         "item_id": placed_id(entry.item_id, entry.text_key, entry.use_original),
         "skill_ids": entry.skill_ids,
         "bullet_ids": [placed_id(bullet.bullet_id, bullet.text_key, bullet.use_original)
                        for bullet in entry.bullets]}
        for entry in section.entries]} for section in draft.sections]
