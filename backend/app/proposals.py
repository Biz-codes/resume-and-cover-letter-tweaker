"""Applying or dismissing one of Claude's proposals from the chat (app/chat.py;
docs/FRONTEND_CHECKS.md, "Chat with Claude").

Applying makes an ordinary change to the document's tree, in one transaction: the proposal is
checked again against the document and the library as they are now, the tree is rebuilt with
the change through the same code as Undo (document_tree.restore), and an added item gets the
defaults it would get added by hand (a role's bullets, a section's items). Claude's new or
reworded text becomes a new library row, used in this document only: a rewording is listed
right after its original, and new text under the section, role, or project it goes in. A skill
added under a skill category or project is listed under it in the library too, as on the page
(document_tree.apply_skills), and a new skill is saved the way the page saves one (under its
category, or under "Other" and the project). The page keeps the document as it was for Undo.
"""

from typing import Any

from sqlalchemy.orm import Session

from app.chat import Placed, Proposal, ProposedChange, check_change
from app.defaults import default_bullets, default_skills
from app.documents import Kind, load_tree
from app.errors import AppError, ErrorCode
from app.library import append, check_unique_name
from app.models import (
    OTHER_CATEGORY_ID,
    BulletPoint,
    ChatMessage,
    ChatRole,
    ExperienceBulletPoint,
    NarrativeContent,
    ProjectBulletPoint,
    ProjectSkill,
    SectionBulletPoint,
    SectionNarrativeContent,
    Skill,
    SkillCategorySkill,
)
from app.routers import bullet_points, narrative_content
from app.routers.bullet_points import BulletIn
from app.routers.document_tree import (
    Placed as PlacedEntry,
)
from app.routers.document_tree import (
    RestoredSection,
    apply_bullets,
    apply_skills,
    fill_section,
    restore,
)
from app.routers.narrative_content import NarrativeIn
from app.suggestions import load_library
from app.usage import touch


def find_proposal(message: ChatMessage, proposal_id: str) -> tuple[int, Proposal]:
    """The proposal shown in Claude's message, by id, or NOT_FOUND."""
    if message.role != ChatRole.assistant:
        raise AppError(ErrorCode.NOT_FOUND)
    for index, stored in enumerate(message.proposals or []):
        if stored.get("id") == proposal_id and stored.get("state") != "left_out":
            return index, Proposal.model_validate(stored)
    raise AppError(ErrorCode.NOT_FOUND)


def set_state(message: ChatMessage, index: int, state: str) -> None:
    # A new list, so the JSONB column sees the change.
    proposals = [dict(stored) for stored in message.proposals]
    proposals[index]["state"] = state
    message.proposals = proposals


def _at(items: list[Any], item: Any, position: int) -> None:
    """Insert counting from 1; 0 or past the end puts it last."""
    index = position - 1 if 1 <= position <= len(items) else len(items)
    items.insert(index, item)


def _tree(sections) -> list[RestoredSection]:
    return [RestoredSection(section_id=section.section_id, entries=[
        PlacedEntry(kind=entry.kind, item_id=entry.item_id,
                    skill_ids=[child.item_id for child in entry.skills],
                    bullet_ids=[child.item_id for child in entry.bullets])
        for entry in section.entries]) for section in sections]


def _new_text(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's new text as a new library row, listed under where it goes."""
    if change.target == "narrative":
        row = NarrativeContent(account_id=account_id, content=change.new_text)
        db.add(row)
        db.flush()
        append(db, SectionNarrativeContent, "section_id", change.section_id, "content_id",
               row.content_id)
        return row.content_id
    row = BulletPoint(account_id=account_id, content=change.new_text)
    db.add(row)
    db.flush()
    if change.parent_kind == "experience":
        append(db, ExperienceBulletPoint, "experience_id", change.parent_id, "bullet_id",
               row.bullet_id)
    elif change.parent_kind == "project":
        append(db, ProjectBulletPoint, "project_id", change.parent_id, "bullet_id",
               row.bullet_id)
    else:
        append(db, SectionBulletPoint, "section_id", change.section_id, "bullet_id",
               row.bullet_id)
    return row.bullet_id


def _new_skill(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's new skill, saved as write_skill saves one on the page: its name must be new
    (DUPLICATE, hidden skills too), and a project's is listed under "Other", since every skill
    has a category. _list_skill lists it under its category or project."""
    check_unique_name(db, Skill.skill_name, account_id, change.new_text, "skill")
    row = Skill(account_id=account_id, skill_name=change.new_text)
    db.add(row)
    db.flush()
    if change.parent_kind == "project":
        append(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id", row.skill_id)
    return row.skill_id


def _list_skill(db: Session, change: ProposedChange, skill_id: int) -> None:
    """List the skill last under its category or project in the library, unless it's there."""
    if change.parent_kind == "category":
        append(db, SkillCategorySkill, "category_id", change.parent_id, "skill_id", skill_id)
    else:
        append(db, ProjectSkill, "project_id", change.parent_id, "skill_id", skill_id)


def _reworded(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's wording as a new row, listed right after the original wherever it's listed."""
    if change.target == "narrative":
        original = db.get(NarrativeContent, change.item_id)
        return narrative_content.new_version(db, original, NarrativeIn(content=change.new_text),
                                             account_id).content_id
    original = db.get(BulletPoint, change.item_id)
    return bullet_points.new_version(db, original, BulletIn(content=change.new_text),
                                     account_id).bullet_id


def apply(db: Session, kind: Kind, account_id: int, doc: Any, change: ProposedChange) -> None:
    """Make the change to the document (see the module docstring), or VALIDATION_FAILED when
    it no longer fits the document or the library."""
    doc_id = getattr(doc, kind.doc_id)
    sections = load_tree(db, kind, doc_id)
    why = check_change(change, load_library(db, account_id), Placed(sections))
    if why:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       f"This change doesn't fit the document as it is now: {why}.")
    tree = _tree(sections)
    action, target = change.action, change.target
    added: tuple[int, str, int] | None = None
    new_section: int | None = None

    if target == "section":
        current = next((s for s in tree if s.section_id == change.section_id), None)
        if action == "add":
            _at(tree, RestoredSection(section_id=change.section_id, entries=[]), change.position)
            new_section = change.section_id
        else:
            tree.remove(current)
            if action == "move":
                _at(tree, current, change.position)
    else:
        section = next(s for s in tree if s.section_id == change.section_id)
        if change.parent_kind:
            parent = next(entry for entry in section.entries
                          if entry.kind == change.parent_kind and entry.item_id == change.parent_id)
            children = parent.skill_ids if target == "skill" else parent.bullet_ids
            if action == "add":
                if change.item_id != 0:
                    item_id = change.item_id
                elif target == "skill":
                    item_id = _new_skill(db, account_id, change)
                else:
                    item_id = _new_text(db, account_id, change)
                if target == "skill":
                    _list_skill(db, change, item_id)
                _at(children, item_id, change.position)
            elif action == "reword":
                children[children.index(change.item_id)] = _reworded(db, account_id, change)
            else:
                children.remove(change.item_id)
                if action == "move":
                    _at(children, change.item_id, change.position)
        else:
            entries = section.entries
            if action == "add":
                item_id = (_new_text(db, account_id, change) if change.item_id == 0
                           else change.item_id)
                _at(entries, PlacedEntry(kind=target, item_id=item_id, skill_ids=[],
                                         bullet_ids=[]), change.position)
                if target in ("category", "project", "experience"):
                    added = (change.section_id, target, item_id)
            else:
                current = next(entry for entry in entries
                               if entry.kind == target and entry.item_id == change.item_id)
                if action == "reword":
                    current.item_id = _reworded(db, account_id, change)
                else:
                    entries.remove(current)
                    if action == "move":
                        _at(entries, current, change.position)

    restore(db, kind, doc_id, tree, account_id)
    if new_section is not None or added is not None:
        # What a section or item gets when it's added by hand.
        placed = {section.section_id: section for section in load_tree(db, kind, doc_id)}
        if new_section is not None:
            fill_section(db, kind, doc_id, placed[new_section].row_id, new_section, account_id)
        else:
            section_id, entry_kind, item_id = added
            section = placed[section_id]
            entry = next(e for e in section.entries
                         if e.kind == entry_kind and e.item_id == item_id)
            if entry_kind in ("category", "project"):
                apply_skills(db, kind, entry_kind, entry.row_id, item_id,
                             default_skills(db, kind, account_id, doc_id, entry_kind, item_id),
                             account_id)
            if entry_kind in ("experience", "project"):
                apply_bullets(db, kind, entry_kind, entry.row_id, section.row_id, item_id,
                              default_bullets(db, kind, account_id, doc_id, entry_kind,
                                              item_id, section.row_id), account_id)
    touch(db, kind.doc, {doc_id})
