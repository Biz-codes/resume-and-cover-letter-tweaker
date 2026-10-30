"""Default selections for a resume or cover letter, until AI suggests them (phase 5): what was
last used, so each new document builds on earlier work (docs/FRONTEND_CHECKS.md, "Defaults").

At each level, the default is what the most recently updated other document of the same kind
showed for the same parent, in its order:
- a new document's sections: the latest document's sections;
- a section's items: the items in the latest document that put anything in that section;
- a category's or project's skills, and a role's or project's bullets: the ones under that
  item in the latest document that showed any.

When no other document has, the default is the first DEFAULT_COUNT items the library lists
under the parent (a section's: of the kind it lists most), or nothing for sections, which no
library list orders. Skills and bullets the library no longer lists under their parent are left
out (a section's items needn't be listed under it), and so are bullets already in the section
(each goes in a section once). Phase 5 replaces these with
AI suggestions; the rest of the app only calls the functions here.
"""

from typing import Any

from sqlalchemy import ColumnElement, select, union_all
from sqlalchemy.orm import Session

from app.documents import LIBRARY, EntryKind, Kind, in_section
from app.models import (
    BulletPoint,
    ExperienceBulletPoint,
    ProjectBulletPoint,
    ProjectSkill,
    SectionBulletPoint,
    SectionEducation,
    SectionExperience,
    SectionNarrativeContent,
    SectionProject,
    SectionSkillCategory,
    Skill,
    SkillCategorySkill,
)

DEFAULT_COUNT = 3

# The library list of each kind of item under a section.
SECTION_LISTS: dict[EntryKind, Any] = {
    "narrative": SectionNarrativeContent, "bullet": SectionBulletPoint,
    "experience": SectionExperience, "project": SectionProject,
    "education": SectionEducation, "category": SectionSkillCategory}

# The kinds in the order the page offers them, which breaks ties for a section's fallback kind.
KINDS_IN_ORDER: list[EntryKind] = ["experience", "project", "category", "education", "bullet",
                                   "narrative"]


def _pk(model) -> Any:
    return model.__table__.primary_key.columns[0]


def _others(kind: Kind, account_id: int, doc_id: int | None) -> list[ColumnElement[bool]]:
    """The account's other documents of this kind."""
    pk = getattr(kind.doc, kind.doc_id)
    conditions = [kind.doc.account_id == account_id]
    if doc_id is not None:
        conditions.append(pk != doc_id)
    return conditions


def _latest(kind: Kind) -> list[Any]:
    """Most recently updated document first."""
    return [kind.doc.updated_at.desc(), getattr(kind.doc, kind.doc_id).desc()]


def default_sections(db: Session, kind: Kind, account_id: int, doc_id: int | None) -> list[int]:
    """The sections of the latest other document that has any, in its order."""
    table = kind.section.__table__
    latest = db.scalar(select(table.c[kind.doc_id])
                       .join(kind.doc, getattr(kind.doc, kind.doc_id) == table.c[kind.doc_id])
                       .where(*_others(kind, account_id, doc_id))
                       .order_by(*_latest(kind)).limit(1))
    if latest is None:
        return []
    return list(db.scalars(select(table.c.section_id).where(table.c[kind.doc_id] == latest)
                           .order_by(table.c.position)))


def _listed(db: Session, link, parent_col: str, parent_id: int, child_col: str,
            library, account_id: int) -> list[int]:
    """The account's items a library list holds under the parent, in its order (a built-in
    parent's list holds every account's)."""
    table = link.__table__
    return list(db.scalars(
        select(table.c[child_col])
        .join(library, getattr(library, child_col) == table.c[child_col])
        .where(table.c[parent_col] == parent_id, library.account_id == account_id)
        .order_by(table.c.position)))


def bullets_in_section(db: Session, kind: Kind, section_row: int) -> set[int]:
    """The bullets already in a section of this document, directly or under an item."""
    table = kind.bullet.__table__
    return set(db.scalars(select(table.c.bullet_id)
                          .where(table.c[kind.column("section")] == section_row)))


def default_entries(db: Session, kind: Kind, account_id: int, doc_id: int, section_id: int,
                    section_row: int) -> list[tuple[EntryKind, int]]:
    """The items to place in one of the document's sections, in order."""
    sections = kind.section.__table__
    doc_pk = getattr(kind.doc, kind.doc_id)
    used = union_all(*(
        select(sections.c[_pk(kind.section).name].label("row"), kind.doc.updated_at,
               doc_pk.label("doc"))
        .select_from(model.__table__)
        .join(sections, _pk(kind.section) == model.__table__.c[kind.column("section")])
        .join(kind.doc, doc_pk == sections.c[kind.doc_id])
        .where(sections.c.section_id == section_id, *_others(kind, account_id, doc_id))
        for _, model in kind.entry_tables())).subquery()
    latest = db.scalar(select(used.c.row)
                       .order_by(used.c.updated_at.desc(), used.c.doc.desc()).limit(1))
    taken = bullets_in_section(db, kind, section_row)
    if latest is not None:
        placed: list[tuple[int, EntryKind, int]] = []
        for entry_kind, model in kind.entry_tables():
            table = model.__table__
            item_column = LIBRARY[entry_kind][1]
            placed += [(position, entry_kind, item_id) for item_id, position in db.execute(
                select(table.c[item_column], table.c.position)
                .where(in_section(kind, model, latest)))]
        return [(entry_kind, item_id) for _, entry_kind, item_id in sorted(placed)
                if not (entry_kind == "bullet" and item_id in taken)]

    best: list[tuple[EntryKind, int]] = []
    for entry_kind in KINDS_IN_ORDER:
        library, item_column, _ = LIBRARY[entry_kind]
        ids = _listed(db, SECTION_LISTS[entry_kind], "section_id", section_id, item_column,
                      library, account_id)
        if entry_kind == "bullet":
            ids = [item_id for item_id in ids if item_id not in taken]
        if len(ids) > len(best):
            best = [(entry_kind, item_id) for item_id in ids]
    return best[:DEFAULT_COUNT]


def _last_children(db: Session, kind: Kind, account_id: int, doc_id: int,
                   entry_kind: EntryKind, item_id: int, child_model, parent: str,
                   child_column: str) -> list[int] | None:
    """The children under the item in the latest other document that showed any, in order, or
    None when none has."""
    entry_model = dict(kind.entry_tables())[entry_kind]
    entries, sections = entry_model.__table__, kind.section.__table__
    children = child_model.__table__
    doc_pk = getattr(kind.doc, kind.doc_id)
    row = db.scalar(
        select(children.c[kind.column(parent)])
        .join(entries, _pk(entry_model) == children.c[kind.column(parent)])
        .join(sections, _pk(kind.section) == entries.c[kind.column("section")])
        .join(kind.doc, doc_pk == sections.c[kind.doc_id])
        .where(entries.c[LIBRARY[entry_kind][1]] == item_id,
               *_others(kind, account_id, doc_id))
        .order_by(*_latest(kind)).limit(1))
    if row is None:
        return None
    return list(db.scalars(select(children.c[child_column])
                           .where(children.c[kind.column(parent)] == row)
                           .order_by(children.c.position)))


def _pick(last: list[int] | None, listed: list[int], skip: set[int] = frozenset()) -> list[int]:
    """What was last used (still listed), or the first few listed."""
    if last is None:
        return [item_id for item_id in listed if item_id not in skip][:DEFAULT_COUNT]
    allowed = set(listed)
    return [item_id for item_id in last if item_id in allowed and item_id not in skip]


def default_skills(db: Session, kind: Kind, account_id: int, doc_id: int,
                   entry_kind: EntryKind, item_id: int) -> list[int]:
    """The skills to show under a placed category or project."""
    if entry_kind == "category":
        listed = _listed(db, SkillCategorySkill, "category_id", item_id, "skill_id", Skill,
                         account_id)
        last = _last_children(db, kind, account_id, doc_id, "category", item_id, kind.skill,
                              "skill_category", "skill_id")
    else:
        listed = _listed(db, ProjectSkill, "project_id", item_id, "skill_id", Skill, account_id)
        last = _last_children(db, kind, account_id, doc_id, "project", item_id,
                              kind.project_skill, "project", "skill_id")
    return _pick(last, listed)


def default_bullets(db: Session, kind: Kind, account_id: int, doc_id: int,
                    entry_kind: EntryKind, item_id: int, section_row: int) -> list[int]:
    """The bullets to show under a placed role or project, leaving out ones already in the
    section."""
    link, parent_col = ((ExperienceBulletPoint, "experience_id") if entry_kind == "experience"
                        else (ProjectBulletPoint, "project_id"))
    listed = _listed(db, link, parent_col, item_id, "bullet_id", BulletPoint, account_id)
    last = _last_children(db, kind, account_id, doc_id, entry_kind, item_id, kind.bullet,
                          entry_kind, "bullet_id")
    return _pick(last, listed, bullets_in_section(db, kind, section_row))
