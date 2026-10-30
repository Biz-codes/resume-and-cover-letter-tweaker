"""Building a resume's or cover letter's header and tree (docs/DATABASE.md, "Join Tables"): its
header's values, its sections in order, the items placed directly in each section (any mix of
kinds, in one order), a category's or project's skills, and a role's or project's bullets.
Writing a new item in place (narrative content, a bullet, a role, a project, an education entry,
a skill category, or a skill under a category or project) saves it to the library, listed under
its section, category, role, or project (docs/FRONTEND_CHECKS.md, "New items are listed under
their parent"), and places it; a new version of a bullet or narrative content takes the
original's place. A section added, or an item placed without its skills or bullets, starts with
its defaults (app/defaults.py).

Like the library lists, a change to a list sends the whole list in its new order. Rows that stay
keep their ids, so what's under them stays too; rows left out are removed with everything under
them. A sent version can't change (VERSION_LOCKED), and every change updates the document's
updated_at. Both kinds of document get the same endpoints through add_tree_routes.
"""

from collections.abc import Callable
from typing import Annotated, Any, Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.defaults import (
    SECTION_LISTS,
    bullets_in_section,
    default_bullets,
    default_entries,
    default_sections,
    default_skills,
)
from app.documents import LIBRARY, EntryKind, Kind, doc_info, in_section, standalone_bullets
from app.errors import AppError, ErrorCode
from app.library import append, check_ids, check_unique_name, list_beside
from app.models import (
    OTHER_CATEGORY_ID,
    BulletPoint,
    ExperienceBulletPoint,
    Header,
    ProjectBulletPoint,
    ProjectSkill,
    Section,
    SectionNarrativeContent,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)
from app.routers.bullet_points import BULLET_LISTS
from app.routers.education import EducationIn
from app.routers.experience import ExperienceIn
from app.routers.headers import HeaderIn, find_identical
from app.routers.projects import ProjectIn
from app.routers.skill_categories import CategoryIn
from app.schemas import RequiredText
from app.usage import touch


class SectionList(BaseModel):
    section_ids: list[int]


class EntryRef(BaseModel):
    kind: EntryKind
    item_id: int


class EntryList(BaseModel):
    entries: list[EntryRef]


class Placed(BaseModel):
    """A saved item to place in a section, with the skills and bullets to show under it. Left
    out (None), they're its defaults (app/defaults.py); an empty list shows none."""

    kind: EntryKind
    item_id: int
    skill_ids: list[int] | None = None
    bullet_ids: list[int] | None = None


class PlacedList(BaseModel):
    items: list[Placed]


class SkillList(BaseModel):
    skill_ids: list[int]


class BulletList(BaseModel):
    bullet_ids: list[int]


class WrittenText(BaseModel):
    kind: Literal["narrative", "bullet"]
    content: RequiredText()
    # A new version of an item of this kind placed directly in the section: the new one takes
    # its place there, and the original stays in the library.
    replaces: int | None = None


class WrittenRole(ExperienceIn):
    kind: Literal["experience"]


class WrittenProject(ProjectIn):
    kind: Literal["project"]


class WrittenEducation(EducationIn):
    kind: Literal["education"]


class WrittenCategory(CategoryIn):
    kind: Literal["category"]


# A new library item of any kind, written in a section, with that kind's own fields.
Written = Annotated[WrittenText | WrittenRole | WrittenProject | WrittenEducation
                    | WrittenCategory, Field(discriminator="kind")]


# Every library list a new version of text is listed in, right after the original, as when
# editing text a sent version uses.
VERSION_LISTS: dict[EntryKind, list[tuple[Any, str]]] = {
    "bullet": BULLET_LISTS, "narrative": [(SectionNarrativeContent, "section_id")]}


class WrittenSkill(BaseModel):
    skill_name: RequiredText(100)


class WrittenBullet(BaseModel):
    content: RequiredText()
    # A new version of a bullet shown under this role or project: the new one takes its place
    # here, and the original stays in the library.
    replaces: int | None = None


def _pk(model) -> Any:
    return model.__table__.primary_key.columns[0]


def _sync(db: Session, model, under: ColumnElement[bool], keys: list[str],
          wanted: dict[tuple[int, ...], int], values: dict[str, Any]) -> None:
    """Make the rows `under` one parent match `wanted` (each row's key columns, and its new
    position): matching rows stay and move, the others are deleted, and new ones are added
    with `values`."""
    table = model.__table__
    pk = _pk(model)
    existing = {tuple(row[1:]): row[0]
                for row in db.execute(select(pk, *(table.c[key] for key in keys)).where(under))}
    gone = [row_id for key, row_id in existing.items() if key not in wanted]
    if gone:
        db.execute(delete(table).where(pk.in_(gone)))
    for key, position in wanted.items():
        if key in existing:
            db.execute(update(table).where(pk == existing[key]).values(position=position))
        else:
            db.execute(insert(table).values({**values, **dict(zip(keys, key, strict=True)),
                                             "position": position}))


def _section_row(db: Session, kind: Kind, doc_id: int, row_id: int) -> int:
    """The section_id of one of the document's sections, or NOT_FOUND."""
    table = kind.section.__table__
    section_id = db.scalar(select(table.c.section_id)
                           .where(_pk(kind.section) == row_id, table.c[kind.doc_id] == doc_id))
    if section_id is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return section_id


def _entry_row(db: Session, kind: Kind, doc_id: int, entry_kind: EntryKind,
               row_id: int) -> tuple[int, int]:
    """The section row and library item id of one of the document's entries, or NOT_FOUND."""
    model = dict(kind.entry_tables())[entry_kind]
    table, sections = model.__table__, kind.section.__table__
    section_column = table.c[kind.column("section")]
    found = db.execute(select(section_column, table.c[LIBRARY[entry_kind][1]])
                       .join(sections, _pk(kind.section) == section_column)
                       .where(_pk(model) == row_id, sections.c[kind.doc_id] == doc_id)).first()
    if found is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return found[0], found[1]


def _next_position(db: Session, kind: Kind, section_row: int) -> int:
    """After the last item placed directly in the section, whatever its kind."""
    last = 0
    for _, model in kind.entry_tables():
        position = db.scalar(select(func.max(model.__table__.c.position))
                             .where(in_section(kind, model, section_row)))
        last = max(last, position or 0)
    return last + 1


def _check_listed(db: Session, link, parent_col: str, parent_id: int, child_col: str,
                  ids: list[int], message: str, field: str) -> None:
    """VALIDATION_FAILED unless the parent lists every id (docs/FRONTEND_CHECKS.md, "Skills in
    a category" and "Bullets")."""
    table = link.__table__
    listed = set(db.scalars(select(table.c[child_col]).where(table.c[parent_col] == parent_id)))
    if not set(ids) <= listed:
        raise AppError(ErrorCode.VALIDATION_FAILED, message, field=field)


def _check_bullets_once(db: Session, kind: Kind, section_row: int, bullet_ids: list[int],
                        elsewhere: ColumnElement[bool], field: str) -> None:
    """A bullet can be placed only once in a section: DUPLICATE if it's already somewhere else
    in it (directly, or under another role or project)."""
    table = kind.bullet.__table__
    taken = db.scalar(select(BulletPoint.content)
                      .join(table, table.c.bullet_id == BulletPoint.bullet_id)
                      .where(table.c[kind.column("section")] == section_row,
                             table.c.bullet_id.in_(bullet_ids), elsewhere).limit(1))
    if taken is not None:
        raise AppError(ErrorCode.DUPLICATE,
                       f'"{taken}" is already in this section. A bullet can be in a section once.',
                       field=field)


def _check_changed(db: Session, library, item_column: str, item_id: int, content: str) -> None:
    """A new version must differ from the item it's a version of (VALIDATION_FAILED), so saving
    an unchanged copy never adds a duplicate to the library."""
    original = db.scalar(select(library.content).where(getattr(library, item_column) == item_id))
    if original is not None and original.strip() == content:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "That's the same as the original. Change the text to save a new version.",
                       field="content")


def apply_skills(db: Session, kind: Kind, entry_kind: str, row_id: int, item_id: int,
                 skill_ids: list[int], account_id: int) -> None:
    """Show these skills under a placed category (only ones the category lists) or project
    (the page offers the project's own list, but any of the account's skills is allowed;
    docs/FRONTEND_CHECKS.md, "Skills in a project")."""
    check_ids(db, Skill, Skill.skill_id, skill_ids, account_id, "skill_ids")
    if entry_kind == "category":
        _check_listed(db, SkillCategorySkill, "category_id", item_id, "skill_id",
                      skill_ids, "Only skills listed under this category can be shown "
                      "with it. Add the skill to the category first.", "skill_ids")
    model = kind.skill if entry_kind == "category" else kind.project_skill
    parent = kind.column("skill_category" if entry_kind == "category" else "project")
    _sync(db, model, model.__table__.c[parent] == row_id, ["skill_id"],
          {(skill_id,): position for position, skill_id in enumerate(skill_ids, 1)},
          {parent: row_id})


def apply_bullets(db: Session, kind: Kind, entry_kind: str, row_id: int, section_row: int,
                  item_id: int, bullet_ids: list[int], account_id: int) -> None:
    """Show these bullets under a placed role or project: only ones it lists, and none
    already placed elsewhere in the same section."""
    check_ids(db, BulletPoint, BulletPoint.bullet_id, bullet_ids, account_id, "bullet_ids")
    link, parent_col = ((ExperienceBulletPoint, "experience_id") if entry_kind == "experience"
                        else (ProjectBulletPoint, "project_id"))
    what = "role" if entry_kind == "experience" else "project"
    _check_listed(db, link, parent_col, item_id, "bullet_id", bullet_ids,
                  f"Only bullets listed under this {what} can be shown with it. Add the "
                  f"bullet to the {what} first.", "bullet_ids")
    parent = kind.bullet.__table__.c[kind.column(entry_kind)]
    _check_bullets_once(db, kind, section_row, bullet_ids, parent.is_distinct_from(row_id),
                        "bullet_ids")
    _sync(db, kind.bullet, parent == row_id, ["bullet_id"],
          {(bullet_id,): position for position, bullet_id in enumerate(bullet_ids, 1)},
          {kind.column("section"): section_row, kind.column(entry_kind): row_id})


def place(db: Session, kind: Kind, section_row: int, placed: Placed, doc_id: int,
          account_id: int) -> None:
    """One saved item, placed last in one of the document's sections, with the skills and
    bullets chosen for it (a category's or project's skills, a role's or project's bullets), or
    its defaults when they're left out (app/defaults.py). An item already in the section
    returns DUPLICATE."""
    library, item_column, _ = LIBRARY[placed.kind]
    check_ids(db, library, getattr(library, item_column), [placed.item_id], account_id,
              "item_id")
    if placed.skill_ids and placed.kind not in ("category", "project"):
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Only a skill category or project shows skills.", field="skill_ids")
    if placed.bullet_ids and placed.kind not in ("experience", "project"):
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Only a role or project shows bullets.", field="bullet_ids")
    model = dict(kind.entry_tables())[placed.kind]
    table = model.__table__
    if db.scalar(select(func.count()).select_from(table).where(
            in_section(kind, model, section_row), table.c[item_column] == placed.item_id)):
        raise AppError(ErrorCode.DUPLICATE, "That's already in this section.", field="item_id")
    if placed.kind == "bullet":
        _check_bullets_once(db, kind, section_row, [placed.item_id], ~standalone_bullets(kind),
                            "item_id")
    entry_row = db.scalar(insert(table).values({
        kind.column("section"): section_row, item_column: placed.item_id,
        "position": _next_position(db, kind, section_row)}).returning(_pk(model)))
    if placed.kind in ("category", "project"):
        skill_ids = placed.skill_ids
        if skill_ids is None:
            skill_ids = default_skills(db, kind, account_id, doc_id, placed.kind, placed.item_id)
        apply_skills(db, kind, placed.kind, entry_row, placed.item_id, skill_ids, account_id)
    if placed.kind in ("experience", "project"):
        bullet_ids = placed.bullet_ids
        if bullet_ids is None:
            bullet_ids = default_bullets(db, kind, account_id, doc_id, placed.kind,
                                         placed.item_id, section_row)
        apply_bullets(db, kind, placed.kind, entry_row, section_row, placed.item_id,
                      bullet_ids, account_id)


def fill_section(db: Session, kind: Kind, doc_id: int, section_row: int, section_id: int,
                 account_id: int) -> None:
    """Place a newly added section's default items, each with its defaults."""
    for entry_kind, item_id in default_entries(db, kind, account_id, doc_id, section_id,
                                               section_row):
        # A role placed first may already show a default bullet.
        if entry_kind == "bullet" and item_id in bullets_in_section(db, kind, section_row):
            continue
        place(db, kind, section_row, Placed(kind=entry_kind, item_id=item_id), doc_id,
              account_id)


def fill_document(db: Session, kind: Kind, doc_id: int, account_id: int) -> None:
    """Give a new document its default sections, each filled with its defaults."""
    table = kind.section.__table__
    for position, section_id in enumerate(default_sections(db, kind, account_id, doc_id), 1):
        row = db.scalar(insert(table).values({kind.doc_id: doc_id, "section_id": section_id,
                                              "position": position})
                        .returning(_pk(kind.section)))
        fill_section(db, kind, doc_id, row, section_id, account_id)


def add_tree_routes(router: APIRouter, kind: Kind, detail: Callable[[Session, Any], Any]) -> None:
    """The endpoints that build the tree, under /{doc_id}. Each returns the document's detail,
    with its new tree and output."""
    entry_kinds = dict(kind.entry_tables())

    def editable(db: Session, doc_id: int, account_id: int) -> Any:
        doc = get_owned(db, kind.doc, doc_id, account_id)
        if doc_info(db, kind, [doc])[doc_id].locked:
            raise AppError(ErrorCode.VERSION_LOCKED)
        return doc

    def changed(db: Session, doc: Any) -> Any:
        doc_id = getattr(doc, kind.doc_id)
        touch(db, kind.doc, {doc_id})
        db.flush()
        db.refresh(doc)
        return detail(db, doc)

    @router.put("/{doc_id}/header")
    def set_header(doc_id: int, body: HeaderIn, db: DbSession, account_id: AccountId):
        """The header's values, each picked or typed on its own. The document points at the
        saved header with exactly these values, or a new one; no header is changed, so other
        versions keep theirs (docs/FRONTEND_CHECKS.md, "Headers")."""
        doc = editable(db, doc_id, account_id)
        header = find_identical(db, account_id, body)
        if header is None:
            header = Header(account_id=account_id, **body.model_dump())
            db.add(header)
            db.flush()
        doc.header_id = header.header_id
        return changed(db, doc)

    @router.put("/{doc_id}/sections")
    def set_sections(doc_id: int, body: SectionList, db: DbSession, account_id: AccountId):
        """The document's sections, in order. A section left out is removed with everything
        placed in it; a new one starts with its default items (see fill_section)."""
        doc = editable(db, doc_id, account_id)
        check_ids(db, Section, Section.id, body.section_ids, account_id, "section_ids",
                  allow_built_in=True)
        table = kind.section.__table__
        under = table.c[kind.doc_id] == doc_id
        before = set(db.scalars(select(table.c.section_id).where(under)))
        _sync(db, kind.section, under, ["section_id"],
              {(section_id,): position for position, section_id in enumerate(body.section_ids, 1)},
              {kind.doc_id: doc_id})
        for row, section_id in db.execute(select(_pk(kind.section), table.c.section_id)
                                          .where(under).order_by(table.c.position)).all():
            if section_id not in before:
                fill_section(db, kind, doc_id, row, section_id, account_id)
        return changed(db, doc)

    @router.put("/{doc_id}/sections/{row_id}/items")
    def set_items(doc_id: int, row_id: int, body: EntryList, db: DbSession,
                  account_id: AccountId):
        """The items placed directly in one of its sections, of any kind, in one order. An item
        left out is removed with its skills and bullets; a new one starts with none."""
        doc = editable(db, doc_id, account_id)
        _section_row(db, kind, doc_id, row_id)
        wanted: dict[EntryKind, dict[tuple[int, ...], int]] = {
            entry_kind: {} for entry_kind in entry_kinds}
        for position, entry in enumerate(body.entries, 1):
            wanted[entry.kind][(entry.item_id,)] = position
        for entry_kind in entry_kinds:
            library, item_column, _ = LIBRARY[entry_kind]
            ids = [entry.item_id for entry in body.entries if entry.kind == entry_kind]
            check_ids(db, library, getattr(library, item_column), ids, account_id, "entries")
        bullet_ids = [key[0] for key in wanted["bullet"]]
        _check_bullets_once(db, kind, row_id, bullet_ids, ~standalone_bullets(kind), "entries")
        for entry_kind, model in entry_kinds.items():
            _sync(db, model, in_section(kind, model, row_id), [LIBRARY[entry_kind][1]],
                  wanted[entry_kind], {kind.column("section"): row_id})
        return changed(db, doc)

    @router.post("/{doc_id}/sections/{row_id}/items", status_code=status.HTTP_201_CREATED)
    def place_items(doc_id: int, row_id: int, body: PlacedList, db: DbSession,
                    account_id: AccountId):
        """Saved items, placed last in one of the document's sections in this order, each with
        the skills and bullets chosen for it, or its defaults (see place)."""
        doc = editable(db, doc_id, account_id)
        _section_row(db, kind, doc_id, row_id)
        for placed in body.items:
            place(db, kind, row_id, placed, doc_id, account_id)
        return changed(db, doc)

    @router.put("/{doc_id}/items/{entry_kind}/{row_id}/skills")
    def set_skills(doc_id: int, entry_kind: Literal["category", "project"], row_id: int,
                   body: SkillList, db: DbSession, account_id: AccountId):
        """The skills shown under a placed category or project (see apply_skills)."""
        doc = editable(db, doc_id, account_id)
        _, item_id = _entry_row(db, kind, doc_id, entry_kind, row_id)
        apply_skills(db, kind, entry_kind, row_id, item_id, body.skill_ids, account_id)
        return changed(db, doc)

    @router.put("/{doc_id}/items/{entry_kind}/{row_id}/bullets")
    def set_bullets(doc_id: int, entry_kind: Literal["experience", "project"], row_id: int,
                    body: BulletList, db: DbSession, account_id: AccountId):
        """The bullets shown under a placed role or project (see apply_bullets)."""
        doc = editable(db, doc_id, account_id)
        section_row, item_id = _entry_row(db, kind, doc_id, entry_kind, row_id)
        apply_bullets(db, kind, entry_kind, row_id, section_row, item_id, body.bullet_ids,
                      account_id)
        return changed(db, doc)

    @router.post("/{doc_id}/sections/{row_id}/written", status_code=status.HTTP_201_CREATED)
    def write_in_section(doc_id: int, row_id: int, body: Written, db: DbSession,
                         account_id: AccountId):
        """A new library item of any kind (narrative content, a bullet, a role, a project, an
        education entry, or a skill category), listed last under the section, and placed last
        in it here. A skill category's name must be new (DUPLICATE). A new version of narrative
        content or a bullet placed here (`replaces`) is listed right after the original wherever
        the original is listed (and under the section), and takes its place here; it must differ
        from the original (VALIDATION_FAILED)."""
        doc = editable(db, doc_id, account_id)
        section_id = _section_row(db, kind, doc_id, row_id)
        if body.kind == "category":
            check_unique_name(db, SkillCategory.category_name, account_id, body.category_name,
                              "skill category")
        library, item_column, _ = LIBRARY[body.kind]
        model = entry_kinds[body.kind]
        table = model.__table__
        replaces = getattr(body, "replaces", None)
        replaced_row = None
        if replaces is not None:
            replaced_row = db.scalar(select(_pk(model)).where(
                in_section(kind, model, row_id), table.c[item_column] == replaces))
            if replaced_row is None:
                raise AppError(ErrorCode.NOT_FOUND, field="replaces")
            _check_changed(db, library, item_column, replaces, body.content)
        item = library(account_id=account_id, **body.model_dump(exclude={"kind", "replaces"}))
        db.add(item)
        db.flush()
        item_id = getattr(item, item_column)
        if replaced_row is not None:
            for link, parent_col in VERSION_LISTS[body.kind]:
                list_beside(db, link, parent_col, item_column, replaces, item_id)
        append(db, SECTION_LISTS[body.kind], "section_id", section_id, item_column, item_id)
        if replaced_row is None:
            db.execute(insert(table).values({
                kind.column("section"): row_id, item_column: item_id,
                "position": _next_position(db, kind, row_id)}))
        else:
            db.execute(update(table).where(_pk(model) == replaced_row)
                       .values({item_column: item_id}))
        return changed(db, doc)

    @router.post("/{doc_id}/items/{entry_kind}/{row_id}/written",
                 status_code=status.HTTP_201_CREATED)
    def write_bullet(doc_id: int, entry_kind: Literal["experience", "project"], row_id: int,
                     body: WrittenBullet, db: DbSession, account_id: AccountId):
        """A new bullet, saved to the library, listed last under the role or project, and shown
        last under it here. A new version of a bullet shown here (`replaces`) is listed right
        after the original under every role, project, and section that lists it, and takes its
        place here; it must differ from the original (VALIDATION_FAILED)."""
        doc = editable(db, doc_id, account_id)
        section_row, item_id = _entry_row(db, kind, doc_id, entry_kind, row_id)
        table = kind.bullet.__table__
        parent = table.c[kind.column(entry_kind)]
        replaced_row = None
        if body.replaces is not None:
            replaced_row = db.scalar(select(_pk(kind.bullet)).where(
                parent == row_id, table.c.bullet_id == body.replaces))
            if replaced_row is None:
                raise AppError(ErrorCode.NOT_FOUND, field="replaces")
            _check_changed(db, BulletPoint, "bullet_id", body.replaces, body.content)
        bullet = BulletPoint(account_id=account_id, content=body.content)
        db.add(bullet)
        db.flush()
        link, parent_col = ((ExperienceBulletPoint, "experience_id") if entry_kind == "experience"
                            else (ProjectBulletPoint, "project_id"))
        if replaced_row is not None:
            for version_link, version_col in BULLET_LISTS:
                list_beside(db, version_link, version_col, "bullet_id", body.replaces,
                            bullet.bullet_id)
        append(db, link, parent_col, item_id, "bullet_id", bullet.bullet_id)
        if replaced_row is None:
            last = db.scalar(select(func.max(table.c.position)).where(parent == row_id))
            db.execute(insert(table).values({
                kind.column("section"): section_row, kind.column(entry_kind): row_id,
                "bullet_id": bullet.bullet_id, "position": (last or 0) + 1}))
        else:
            db.execute(update(table).where(_pk(kind.bullet) == replaced_row)
                       .values(bullet_id=bullet.bullet_id))
        return changed(db, doc)

    @router.post("/{doc_id}/items/{entry_kind}/{row_id}/skills/written",
                 status_code=status.HTTP_201_CREATED)
    def write_skill(doc_id: int, entry_kind: Literal["category", "project"], row_id: int,
                    body: WrittenSkill, db: DbSession, account_id: AccountId):
        """A new skill, saved to the library, listed last under the category (a project's is
        listed under "Other", since every skill has a category, and under the project), and
        shown last under it here. Its name must be new (DUPLICATE)."""
        doc = editable(db, doc_id, account_id)
        _, item_id = _entry_row(db, kind, doc_id, entry_kind, row_id)
        check_unique_name(db, Skill.skill_name, account_id, body.skill_name, "skill")
        skill = Skill(account_id=account_id, skill_name=body.skill_name)
        db.add(skill)
        db.flush()
        if entry_kind == "category":
            append(db, SkillCategorySkill, "category_id", item_id, "skill_id", skill.skill_id)
            model, parent = kind.skill, kind.column("skill_category")
        else:
            append(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id",
                   skill.skill_id)
            append(db, ProjectSkill, "project_id", item_id, "skill_id", skill.skill_id)
            model, parent = kind.project_skill, kind.column("project")
        table = model.__table__
        last = db.scalar(select(func.max(table.c.position)).where(table.c[parent] == row_id))
        db.execute(insert(table).values({parent: row_id, "skill_id": skill.skill_id,
                                         "position": (last or 0) + 1}))
        return changed(db, doc)
