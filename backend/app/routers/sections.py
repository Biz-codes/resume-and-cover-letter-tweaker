"""Sections: the headings of a resume, or the topics of a cover letter.

The five built-in sections are shared by every account and can't be renamed or deleted.
Renaming a section that a sent version uses saves a new section (docs/FRONTEND_CHECKS.md,
"Sent versions are locked").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.account import AccountId
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.library import check_ids, check_unique_name, copy_children, set_children
from app.models import (
    OTHER_CATEGORY_ID,
    Section,
    SectionBulletPoint,
    SectionEducation,
    SectionExperience,
    SectionNarrativeContent,
    SectionProject,
    SectionSkillCategory,
    SkillCategory,
)
from app.schemas import RequiredText
from app.usage import SECTION_LINKS, Use, switch_unsent, used_by_sent_version, uses

router = APIRouter(prefix="/api/sections", tags=["sections"])

# Every library list a section has, copied to a new version of the section.
SECTION_LISTS = [SectionNarrativeContent, SectionSkillCategory, SectionExperience,
                 SectionProject, SectionBulletPoint, SectionEducation]


class SectionIn(BaseModel):
    title: RequiredText(100)


class CategoryRef(BaseModel):
    category_id: int
    category_name: str


class SectionOut(BaseModel):
    id: int
    title: str
    built_in: bool
    skill_categories: list[CategoryRef]
    used_by: list[Use]


class CategoryList(BaseModel):
    category_ids: list[int]


def visible(account_id: int):
    """Sections the account can use: the built-in ones and its own."""
    return or_(Section.account_id == account_id, Section.account_id.is_(None))


def own_categories(account_id: int):
    return select(SkillCategory.category_id).where(SkillCategory.account_id == account_id)


def get_section(db: Session, section_id: int, account_id: int) -> Section:
    section = db.get(Section, section_id)
    if section is None or section.account_id not in (None, account_id):
        raise AppError(ErrorCode.NOT_FOUND)
    return section


def protect_built_in(section: Section, action: str) -> None:
    if section.account_id is None:
        raise AppError(ErrorCode.BUILT_IN_PROTECTED,
                       f'"{section.title}" is built in and can\'t be {action}.')


def categories_by_section(db: Session, section_ids: list[int],
                          account_id: int) -> dict[int, list[CategoryRef]]:
    found: dict[int, list[CategoryRef]] = {section_id: [] for section_id in section_ids}
    rows = db.execute(
        select(SectionSkillCategory.section_id, SkillCategory.category_id,
               SkillCategory.category_name)
        .join(SkillCategory, SkillCategory.category_id == SectionSkillCategory.category_id)
        .where(SectionSkillCategory.section_id.in_(section_ids),
               SkillCategory.account_id == account_id)
        .order_by(SectionSkillCategory.position))
    for section_id, category_id, name in rows:
        found[section_id].append(CategoryRef(category_id=category_id, category_name=name))
    return found


def to_out(db: Session, sections: list[Section], account_id: int) -> list[SectionOut]:
    ids = [section.id for section in sections]
    categories = categories_by_section(db, ids, account_id)
    used_by = uses(db, SECTION_LINKS, ids)
    return [SectionOut(id=section.id, title=section.title, built_in=section.account_id is None,
                       skill_categories=categories[section.id], used_by=used_by[section.id])
            for section in sections]


def one_out(db: Session, section: Section, account_id: int) -> SectionOut:
    return to_out(db, [section], account_id)[0]


@router.get("")
def list_sections(db: DbSession, account_id: AccountId) -> list[SectionOut]:
    """Built-in sections first (in their fixed order), then the account's, by title."""
    sections = db.scalars(
        select(Section).where(visible(account_id))
        .order_by(Section.account_id.is_not(None), Section.id)
    ).all()
    built_in = [section for section in sections if section.account_id is None]
    own = sorted((section for section in sections if section.account_id is not None),
                 key=lambda section: section.title.lower())
    return to_out(db, [*built_in, *own], account_id)


@router.get("/{section_id}")
def get_one(section_id: int, db: DbSession, account_id: AccountId) -> SectionOut:
    return one_out(db, get_section(db, section_id, account_id), account_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_section(body: SectionIn, db: DbSession, account_id: AccountId) -> SectionOut:
    check_unique_name(db, Section.title, account_id, body.title, "section")
    section = Section(account_id=account_id, title=body.title)
    db.add(section)
    db.flush()
    return one_out(db, section, account_id)


@router.put("/{section_id}")
def rename_section(section_id: int, body: SectionIn, db: DbSession,
                   account_id: AccountId) -> SectionOut:
    """Renames the section, unless a sent version uses it.

    Then the new title is saved as a new section with the same lists, and unsent resumes and
    cover letters switch to it. The response's id differs from the one in the url then.
    """
    section = get_section(db, section_id, account_id)
    if section.title == body.title:
        return one_out(db, section, account_id)
    protect_built_in(section, "renamed")
    check_unique_name(db, Section.title, account_id, body.title, "section",
                      exclude=Section.id != section_id)
    if not used_by_sent_version(db, SECTION_LINKS, section_id):
        section.title = body.title
        db.flush()
        db.refresh(section)
        return one_out(db, section, account_id)

    replacement = Section(account_id=account_id, title=body.title)
    db.add(replacement)
    db.flush()
    for link in SECTION_LISTS:
        copy_children(db, link, "section_id", section_id, replacement.id)
    switch_unsent(db, SECTION_LINKS, section_id, replacement.id)
    return one_out(db, replacement, account_id)


@router.put("/{section_id}/skill-categories")
def set_section_categories(section_id: int, body: CategoryList, db: DbSession,
                           account_id: AccountId) -> SectionOut:
    """Replaces the skill categories the section lists, in order."""
    section = get_section(db, section_id, account_id)
    if OTHER_CATEGORY_ID in body.category_ids:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       '"Other" isn\'t listed under sections; it\'s offered wherever skills go.',
                       field="category_ids")
    check_ids(db, SkillCategory, SkillCategory.category_id, body.category_ids, account_id,
              field="category_ids")
    set_children(db, SectionSkillCategory, "section_id", section_id, "category_id",
                 body.category_ids, visible=own_categories(account_id))
    return one_out(db, section, account_id)


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(section_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it from every resume and cover letter; the items it listed stay."""
    section = get_section(db, section_id, account_id)
    protect_built_in(section, "deleted")
    db.delete(section)
