"""Which resumes and cover letters use a library item, and switching them to a new version.

Each kind of library item is reached from a resume or cover letter through one or more join
tables (a skill through resume_skill and resume_project_skill, for example). A Link describes
one of those paths, so the same code finds every use and moves unsent versions to a new row
(docs/FRONTEND_CHECKS.md, "Sent versions are locked").
"""

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import Session

from app.models import (
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
)
from app.versions import is_locked


class Use(BaseModel):
    """A job posting, resume, or cover letter that uses a library item."""

    kind: Literal["job_posting", "resume", "cover_letter"]
    id: int
    name: str
    # A sent version (or a posting already applied to) keeps the item as it is.
    locked: bool


@dataclass(frozen=True)
class Link:
    """One path from a resume or cover letter to a library item, through a join table."""

    model: Any  # the join table whose `item` column points at the library item
    item: Any
    # Selects (join row id, item id, document id) for every row of the join table.
    rows: Select
    doc: type[Resume] | type[CoverLetter]


def doc_id(doc: type[Resume] | type[CoverLetter]):
    return Resume.resume_id if doc is Resume else CoverLetter.letter_id


def _link(doc: type[Resume] | type[CoverLetter], model, item, row_id, *joins) -> Link:
    section_doc = ResumeSection.resume_id if doc is Resume else CoverLetterSection.letter_id
    query = select(row_id, item, section_doc).select_from(model)
    for target, on in joins:
        query = query.join(target, on)
    return Link(model, item, query, doc)


def _resume_link(model, item, row_id, *joins) -> Link:
    return _link(Resume, model, item, row_id, *joins)


def _letter_link(model, item, row_id, *joins) -> Link:
    return _link(CoverLetter, model, item, row_id, *joins)


RS, CS = ResumeSection, CoverLetterSection
RSC, CSC = ResumeSkillCategory, CoverLetterSkillCategory
RP, CP = ResumeProject, CoverLetterProject

SECTION_LINKS = [
    _resume_link(RS, RS.section_id, RS.resume_section_id),
    _letter_link(CS, CS.section_id, CS.cover_letter_section_id),
]
CATEGORY_LINKS = [
    _resume_link(RSC, RSC.category_id, RSC.resume_skill_category_id,
                 (RS, RS.resume_section_id == RSC.resume_section_id)),
    _letter_link(CSC, CSC.category_id, CSC.cover_letter_skill_category_id,
                 (CS, CS.cover_letter_section_id == CSC.cover_letter_section_id)),
]
SKILL_LINKS = [
    _resume_link(ResumeSkill, ResumeSkill.skill_id, ResumeSkill.resume_skill_id,
                 (RSC, RSC.resume_skill_category_id == ResumeSkill.resume_skill_category_id),
                 (RS, RS.resume_section_id == RSC.resume_section_id)),
    _resume_link(ResumeProjectSkill, ResumeProjectSkill.skill_id,
                 ResumeProjectSkill.resume_project_skill_id,
                 (RP, RP.resume_project_id == ResumeProjectSkill.resume_project_id),
                 (RS, RS.resume_section_id == RP.resume_section_id)),
    _letter_link(CoverLetterSkill, CoverLetterSkill.skill_id,
                 CoverLetterSkill.cover_letter_skill_id,
                 (CSC, CSC.cover_letter_skill_category_id
                  == CoverLetterSkill.cover_letter_skill_category_id),
                 (CS, CS.cover_letter_section_id == CSC.cover_letter_section_id)),
    _letter_link(CoverLetterProjectSkill, CoverLetterProjectSkill.skill_id,
                 CoverLetterProjectSkill.cover_letter_project_skill_id,
                 (CP, CP.cover_letter_project_id
                  == CoverLetterProjectSkill.cover_letter_project_id),
                 (CS, CS.cover_letter_section_id == CP.cover_letter_section_id)),
]

EXPERIENCE_LINKS = [
    _resume_link(ResumeExperience, ResumeExperience.experience_id,
                 ResumeExperience.resume_experience_id,
                 (RS, RS.resume_section_id == ResumeExperience.resume_section_id)),
    _letter_link(CoverLetterExperience, CoverLetterExperience.experience_id,
                 CoverLetterExperience.cover_letter_experience_id,
                 (CS, CS.cover_letter_section_id
                  == CoverLetterExperience.cover_letter_section_id)),
]
PROJECT_LINKS = [
    _resume_link(RP, RP.project_id, RP.resume_project_id,
                 (RS, RS.resume_section_id == RP.resume_section_id)),
    _letter_link(CP, CP.project_id, CP.cover_letter_project_id,
                 (CS, CS.cover_letter_section_id == CP.cover_letter_section_id)),
]
BULLET_LINKS = [
    _resume_link(ResumeBulletPoint, ResumeBulletPoint.bullet_id,
                 ResumeBulletPoint.resume_bullet_point_id,
                 (RS, RS.resume_section_id == ResumeBulletPoint.resume_section_id)),
    _letter_link(CoverLetterBulletPoint, CoverLetterBulletPoint.bullet_id,
                 CoverLetterBulletPoint.cover_letter_bullet_point_id,
                 (CS, CS.cover_letter_section_id
                  == CoverLetterBulletPoint.cover_letter_section_id)),
]
NARRATIVE_LINKS = [
    _resume_link(ResumeNarrativeContent, ResumeNarrativeContent.content_id,
                 ResumeNarrativeContent.resume_narrative_content_id,
                 (RS, RS.resume_section_id == ResumeNarrativeContent.resume_section_id)),
    _letter_link(CoverLetterNarrativeContent, CoverLetterNarrativeContent.content_id,
                 CoverLetterNarrativeContent.cover_letter_narrative_content_id,
                 (CS, CS.cover_letter_section_id
                  == CoverLetterNarrativeContent.cover_letter_section_id)),
]
EDUCATION_LINKS = [
    _resume_link(ResumeEducation, ResumeEducation.education_id,
                 ResumeEducation.resume_education_id,
                 (RS, RS.resume_section_id == ResumeEducation.resume_section_id)),
    _letter_link(CoverLetterEducation, CoverLetterEducation.education_id,
                 CoverLetterEducation.cover_letter_education_id,
                 (CS, CS.cover_letter_section_id == CoverLetterEducation.cover_letter_section_id)),
]


def uses(db: Session, links: list[Link], item_ids: list[int]) -> dict[int, list[Use]]:
    """Every resume and cover letter using each item, once each, resumes first."""
    found: dict[int, list[Use]] = {item_id: [] for item_id in item_ids}
    seen: set[tuple[int, str, int]] = set()
    for link in links:
        rows = link.rows.subquery()
        row_item, row_doc = rows.c[1], rows.c[2]
        doc_pk = doc_id(link.doc)
        kind = "resume" if link.doc is Resume else "cover_letter"
        query = (select(row_item, doc_pk, link.doc.name, is_locked(link.doc))
                 .join(link.doc, doc_pk == row_doc)
                 .where(row_item.in_(item_ids))
                 .order_by(doc_pk))
        for item_id, document_id, name, locked in db.execute(query):
            if (item_id, kind, document_id) not in seen:
                seen.add((item_id, kind, document_id))
                found[item_id].append(Use(kind=kind, id=document_id, name=name,
                                          locked=bool(locked)))
    for item_uses in found.values():
        item_uses.sort(key=lambda use: (use.kind != "resume", use.id))
    return found


def used_by_sent_version(db: Session, links: list[Link], item_id: int) -> bool:
    return any(use.locked for use in uses(db, links, [item_id])[item_id])


def switch_unsent(db: Session, links: list[Link], old_id: int, new_id: int) -> None:
    """Point every unsent resume and cover letter that uses old_id at new_id instead."""
    for link in links:
        rows = link.rows.subquery()
        row_id, row_item, row_doc = rows.c[0], rows.c[1], rows.c[2]
        doc_pk = doc_id(link.doc)
        unsent = (select(row_id, row_doc).join(link.doc, doc_pk == row_doc)
                  .where(row_item == old_id, ~is_locked(link.doc)))
        moved = db.execute(unsent).all()
        if not moved:
            continue
        pk = link.model.__table__.primary_key.columns[0]
        db.execute(update(link.model).where(pk.in_([row for row, _ in moved]))
                   .values({link.item.key: new_id}))
        touch(db, link.doc, {doc for _, doc in moved})


def touch(db: Session, doc: type[Resume] | type[CoverLetter], doc_ids: set[int]) -> None:
    """Selections changed, so the documents were updated (join tables have no timestamps)."""
    if doc_ids:
        db.execute(update(doc).where(doc_id(doc).in_(doc_ids)).values(updated_at=func.now()))


def column_uses(db: Session, columns: list[Any], item_ids: list[int]) -> dict[int, list[Use]]:
    """Every resume and cover letter whose own column (tone_set_id, sign_off_id) holds each
    item, resumes first."""
    found: dict[int, list[Use]] = {item_id: [] for item_id in item_ids}
    for column in columns:
        doc = column.class_
        kind = "resume" if doc is Resume else "cover_letter"
        query = (select(column, doc_id(doc), doc.name, is_locked(doc))
                 .where(column.in_(item_ids)).order_by(doc_id(doc)))
        for item_id, document_id, name, locked in db.execute(query):
            found[item_id].append(Use(kind=kind, id=document_id, name=name, locked=bool(locked)))
    return found


def switch_unsent_column(db: Session, column: Any, old_id: int, new_id: int) -> None:
    """Point every unsent resume or cover letter whose column holds old_id at new_id."""
    doc = column.class_
    db.execute(update(doc).where(column == old_id, ~is_locked(doc)).values({column.key: new_id}))
