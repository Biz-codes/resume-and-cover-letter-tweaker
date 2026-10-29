"""Resumes and cover letters, the two kinds of document, which share one structure.

Each document is a tree of selections (docs/DATABASE.md, "Join Tables"): its sections, the
items placed in each section, and the skills and bullets under those items. The cover letter
join tables mirror the resume ones, with "cover_letter" in place of "resume" in their names, so
a Kind names one set of tables and the same code reads and copies either kind.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import insert, select, union_all
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode
from app.library import check_ids
from app.models import (
    BulletPoint,
    CoverLetter,
    CoverLetterBulletPoint,
    CoverLetterEducation,
    CoverLetterExperience,
    CoverLetterNarrativeContent,
    CoverLetterProject,
    CoverLetterProjectSkill,
    CoverLetterSection,
    CoverLetterSkill,
    CoverLetterSkillCategory,
    Education,
    Experience,
    Header,
    JobPosting,
    NarrativeContent,
    Project,
    Resume,
    ResumeBulletPoint,
    ResumeEducation,
    ResumeExperience,
    ResumeNarrativeContent,
    ResumeProject,
    ResumeProjectSkill,
    ResumeSection,
    ResumeSkill,
    ResumeSkillCategory,
    Section,
    Skill,
    SkillCategory,
)
from app.usage import Use
from app.versions import is_locked

EntryKind = Literal["narrative", "category", "experience", "project", "bullet", "education"]


@dataclass(frozen=True)
class Kind:
    """The tables of one kind of document. Join table columns are named with `prefix`:
    resume_section_id or cover_letter_section_id, and so on."""

    prefix: Literal["resume", "cover_letter"]
    doc: Any
    doc_id: str
    based_on: str
    section: Any
    narrative: Any
    category: Any
    skill: Any
    experience: Any
    project: Any
    project_skill: Any
    bullet: Any
    education: Any

    def column(self, name: str) -> str:
        """A join table column, e.g. column("section") is "resume_section_id"."""
        return f"{self.prefix}_{name}_id"

    def entry_tables(self) -> list[tuple[EntryKind, Any]]:
        """The join tables for items placed directly in a section, which share one position
        numbering per section."""
        return [("narrative", self.narrative), ("category", self.category),
                ("experience", self.experience), ("project", self.project),
                ("bullet", self.bullet), ("education", self.education)]


RESUME = Kind("resume", Resume, "resume_id", "based_on_resume_id", ResumeSection,
              ResumeNarrativeContent, ResumeSkillCategory, ResumeSkill, ResumeExperience,
              ResumeProject, ResumeProjectSkill, ResumeBulletPoint, ResumeEducation)
COVER_LETTER = Kind("cover_letter", CoverLetter, "letter_id", "based_on_letter_id",
                    CoverLetterSection, CoverLetterNarrativeContent, CoverLetterSkillCategory,
                    CoverLetterSkill, CoverLetterExperience, CoverLetterProject,
                    CoverLetterProjectSkill, CoverLetterBulletPoint, CoverLetterEducation)

# Each kind of entry: its library table, the id column it shares with the join table, and the
# library columns the document prints.
LIBRARY: dict[EntryKind, tuple[Any, str, list[str]]] = {
    "narrative": (NarrativeContent, "content_id", ["content"]),
    "category": (SkillCategory, "category_id", ["category_name"]),
    "experience": (Experience, "experience_id", ["role_title", "organization", "location",
                                                 "dates"]),
    "project": (Project, "project_id", ["project_title", "done_for", "url", "dates"]),
    "bullet": (BulletPoint, "bullet_id", ["content"]),
    "education": (Education, "education_id", ["degree", "institution", "details", "graduation"]),
}


@dataclass
class Child:
    """A skill under a category or project, or a bullet under a role or project."""

    row_id: int
    item_id: int
    position: int
    text: str


@dataclass
class Entry:
    """An item placed directly in a section, with the library values it prints."""

    kind: EntryKind
    row_id: int
    item_id: int
    position: int
    values: dict[str, str | None]
    skills: list[Child] = field(default_factory=list)
    bullets: list[Child] = field(default_factory=list)


@dataclass
class SectionTree:
    row_id: int
    section_id: int
    title: str
    entries: list[Entry]


def _primary_key(model) -> Any:
    return model.__table__.primary_key.columns[0]


def load_tree(db: Session, kind: Kind, doc_id: int) -> list[SectionTree]:
    """The document's sections in order, each with its entries in order."""
    section_table = kind.section.__table__
    section_pk = _primary_key(kind.section)
    sections = [
        SectionTree(row_id, section_id, title, [])
        for row_id, section_id, title in db.execute(
            select(section_pk, section_table.c.section_id, Section.title)
            .join(Section, Section.id == section_table.c.section_id)
            .where(section_table.c[kind.doc_id] == doc_id)
            .order_by(section_table.c.position))
    ]
    by_section = {section.row_id: section for section in sections}
    entries: dict[tuple[EntryKind, int], Entry] = {}
    nested_bullets: list[tuple[Entry | None, Child]] = []

    for entry_kind, model in kind.entry_tables():
        library, item_column, value_columns = LIBRARY[entry_kind]
        table, library_table = model.__table__, library.__table__
        parent_columns = ([table.c[kind.column("experience")], table.c[kind.column("project")]]
                          if entry_kind == "bullet" else [])
        query = (select(_primary_key(model), table.c[kind.column("section")], table.c.position,
                        table.c[item_column], *parent_columns,
                        *(library_table.c[name] for name in value_columns))
                 .join(library_table, library_table.c[item_column] == table.c[item_column])
                 .where(table.c[kind.column("section")].in_(by_section)))
        for row in db.execute(query):
            row_id, section_row, position, item_id = row[:4]
            parents = row[4:4 + len(parent_columns)]
            values = dict(zip(value_columns, row[4 + len(parent_columns):], strict=True))
            if entry_kind == "bullet" and any(parents):
                # A bullet under a role or project on this document.
                experience_row, project_row = parents
                parent = (entries.get(("experience", experience_row)) if experience_row
                          else entries.get(("project", project_row)))
                nested_bullets.append((parent, Child(row_id, item_id, position,
                                                     values["content"] or "")))
                continue
            entry = Entry(entry_kind, row_id, item_id, position, values)
            entries[(entry_kind, row_id)] = entry
            by_section[section_row].entries.append(entry)

    for parent, child in nested_bullets:
        if parent is not None:
            parent.bullets.append(child)
    for skills_model, parent_kind in ((kind.skill, "category"), (kind.project_skill, "project")):
        table = skills_model.__table__
        parent_column = table.c[kind.column("skill_category" if parent_kind == "category"
                                            else "project")]
        parent_ids = [row_id for entry_kind, row_id in entries if entry_kind == parent_kind]
        query = (select(_primary_key(skills_model), parent_column, table.c.position,
                        table.c.skill_id, Skill.skill_name)
                 .join(Skill, Skill.skill_id == table.c.skill_id)
                 .where(parent_column.in_(parent_ids)))
        for row_id, parent_row, position, skill_id, name in db.execute(query):
            entries[(parent_kind, parent_row)].skills.append(
                Child(row_id, skill_id, position, name))

    for entry in entries.values():
        entry.skills.sort(key=lambda child: child.position)
        entry.bullets.sort(key=lambda child: child.position)
    for section in sections:
        section.entries.sort(key=lambda entry: entry.position)
    return sections


def _copy_rows(db: Session, model, by: str, remap: dict[str, dict[int, int]]) -> dict[int, int]:
    """Copy the rows of a join table whose `by` column is one of the copied parents, pointing
    each remapped column at its parent's copy. Returns the new id of each copied row."""
    table = model.__table__
    pk = _primary_key(model)
    copied: dict[int, int] = {}
    rows = db.execute(select(table).where(table.c[by].in_(list(remap[by]))).order_by(pk)).mappings()
    for row in rows.all():
        values = {name: value for name, value in row.items() if name != pk.name}
        for name, mapping in remap.items():
            if values[name] is not None:
                values[name] = mapping[values[name]]
        copied[row[pk.name]] = db.scalar(insert(table).values(values).returning(pk))
    return copied


def copy_tree(db: Session, kind: Kind, old_id: int, new_id: int) -> None:
    """Copy every join row under the original into the new document: sections, then the items
    in them, then their skills and bullets, with the same positions (docs/FRONTEND_CHECKS.md,
    "Copy the whole tree"). The library items themselves aren't copied."""
    sections = _copy_rows(db, kind.section, kind.doc_id, {kind.doc_id: {old_id: new_id}})
    by_section = {kind.column("section"): sections}
    copied = {entry_kind: _copy_rows(db, model, kind.column("section"), by_section)
              for entry_kind, model in kind.entry_tables() if entry_kind != "bullet"}
    _copy_rows(db, kind.skill, kind.column("skill_category"),
               {kind.column("skill_category"): copied["category"]})
    _copy_rows(db, kind.project_skill, kind.column("project"),
               {kind.column("project"): copied["project"]})
    _copy_rows(db, kind.bullet, kind.column("section"),
               {**by_section, kind.column("experience"): copied["experience"],
                kind.column("project"): copied["project"]})


# Shared by the resume and cover letter endpoints (app/routers/resumes.py, cover_letters.py).


class PostingRef(BaseModel):
    job_posting_id: int
    organization: str
    role_title: str


class DocRef(BaseModel):
    id: int
    name: str


class DocInfo(BaseModel):
    """What both kinds of document show besides their own fields."""

    job_posting: PostingRef | None
    based_on: DocRef | None
    # Sent: its posting has an applied_on date, so only its name can change.
    locked: bool
    # The versions copied from it, which a delete keeps (their based_on is cleared).
    copies: list[Use]
    updated_at: datetime | None


def doc_info(db: Session, kind: Kind, docs: list[Any]) -> dict[int, DocInfo]:
    ids = [getattr(doc, kind.doc_id) for doc in docs]
    postings = {posting.job_posting_id: posting for posting in db.scalars(
        select(JobPosting).where(JobPosting.job_posting_id.in_(
            [doc.job_posting_id for doc in docs if doc.job_posting_id])))}
    based_on_ids = [getattr(doc, kind.based_on) for doc in docs if getattr(doc, kind.based_on)]
    pk = getattr(kind.doc, kind.doc_id)
    names = dict(db.execute(select(pk, kind.doc.name).where(pk.in_(based_on_ids))).all())
    copies: dict[int, list[Use]] = {doc_id: [] for doc_id in ids}
    based_on = getattr(kind.doc, kind.based_on)
    for original, copy_id, name, locked in db.execute(
            select(based_on, pk, kind.doc.name, is_locked(kind.doc))
            .where(based_on.in_(ids)).order_by(pk)):
        copies[original].append(Use(kind=kind.prefix, id=copy_id, name=name, locked=bool(locked)))

    found = {}
    for doc in docs:
        posting = postings.get(doc.job_posting_id)
        original = getattr(doc, kind.based_on)
        found[getattr(doc, kind.doc_id)] = DocInfo(
            job_posting=PostingRef(job_posting_id=posting.job_posting_id,
                                   organization=posting.organization,
                                   role_title=posting.role_title) if posting else None,
            based_on=DocRef(id=original, name=names[original]) if original in names else None,
            locked=posting is not None and posting.applied_on is not None,
            copies=copies[getattr(doc, kind.doc_id)],
            updated_at=doc.updated_at)
    return found


def list_docs(db: Session, kind: Kind, account_id: int) -> list[Any]:
    """Most recently updated first."""
    return list(db.scalars(select(kind.doc).where(kind.doc.account_id == account_id)
                           .order_by(kind.doc.updated_at.desc(),
                                     getattr(kind.doc, kind.doc_id).desc())))


def check_link(db: Session, model, column, item_id: int | None, account_id: int,
               field: str) -> None:
    """The header, tone set, or sign-off picked must be the account's own."""
    if item_id is not None:
        check_ids(db, model, column, [item_id], account_id, field)


def latest_header_id(db: Session, account_id: int) -> int | None:
    """The header of the most recently updated resume, cover letter, or posting that has one,
    or else the most recently updated header (docs/FRONTEND_CHECKS.md, "Headers")."""
    used = [select(model.header_id, model.updated_at)
            .where(model.account_id == account_id, model.header_id.is_not(None))
            for model in (Resume, CoverLetter, JobPosting)]
    latest = union_all(*used).subquery()
    header_id = db.scalar(select(latest.c.header_id)
                          .order_by(latest.c.updated_at.desc()).limit(1))
    if header_id is None:
        header_id = db.scalar(select(Header.header_id).where(Header.account_id == account_id)
                              .order_by(Header.updated_at.desc(), Header.header_id.desc())
                              .limit(1))
    return header_id


def refuse_locked_change(doc: Any, info: DocInfo, changes: dict[str, Any]) -> None:
    """A sent version can only be renamed (docs/FRONTEND_CHECKS.md, "Sent versions are
    locked"): VERSION_LOCKED if any other field would change."""
    if info.locked and any(getattr(doc, name) != value for name, value in changes.items()
                           if name != "name"):
        raise AppError(ErrorCode.VERSION_LOCKED)
