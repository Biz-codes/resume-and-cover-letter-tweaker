"""Skill categories and the skills each one lists.

The built-in "Other" category is shared by every account and can't be renamed or deleted.
Deleting a category moves its skills and its resume and cover letter selections under
"Other" first (docs/FRONTEND_CHECKS.md, "Deleting a skill category").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.account import AccountId
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.library import (
    append,
    check_ids,
    check_unique_name,
    copy_children,
    list_beside,
    set_children,
)
from app.models import (
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    CoverLetter,
    CoverLetterSection,
    CoverLetterSkill,
    CoverLetterSkillCategory,
    Resume,
    ResumeSection,
    ResumeSkill,
    ResumeSkillCategory,
    Section,
    SectionSkillCategory,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)
from app.routers.sections import get_section
from app.schemas import RequiredText
from app.usage import CATEGORY_LINKS, Use, switch_unsent, touch, used_by_sent_version, uses

router = APIRouter(prefix="/api/skill-categories", tags=["skill categories"])


class CategoryIn(BaseModel):
    category_name: RequiredText(100)


class NewCategory(CategoryIn):
    # The section that lists the new category: "Skills" unless the user picks another,
    # or none (null).
    section_id: int | None = SKILLS_SECTION_ID


class SkillRef(BaseModel):
    skill_id: int
    skill_name: str


class SectionRef(BaseModel):
    id: int
    title: str


class CategoryOut(BaseModel):
    category_id: int
    category_name: str
    built_in: bool
    skills: list[SkillRef]
    sections: list[SectionRef]
    used_by: list[Use]


class SkillList(BaseModel):
    skill_ids: list[int]


def own_skills(account_id: int):
    return select(Skill.skill_id).where(Skill.account_id == account_id)


def get_category(db: Session, category_id: int, account_id: int) -> SkillCategory:
    category = db.get(SkillCategory, category_id)
    if category is None or category.account_id not in (None, account_id):
        raise AppError(ErrorCode.NOT_FOUND)
    return category


def protect_other(category: SkillCategory, action: str) -> None:
    if category.category_id == OTHER_CATEGORY_ID:
        raise AppError(ErrorCode.BUILT_IN_PROTECTED, f'"Other" is built in and can\'t be {action}.')


def to_out(db: Session, categories: list[SkillCategory], account_id: int) -> list[CategoryOut]:
    ids = [category.category_id for category in categories]
    skills: dict[int, list[SkillRef]] = {category_id: [] for category_id in ids}
    for category_id, skill_id, name in db.execute(
            select(SkillCategorySkill.category_id, Skill.skill_id, Skill.skill_name)
            .join(Skill, Skill.skill_id == SkillCategorySkill.skill_id)
            .where(SkillCategorySkill.category_id.in_(ids), Skill.account_id == account_id)
            .order_by(SkillCategorySkill.position)):
        skills[category_id].append(SkillRef(skill_id=skill_id, skill_name=name))
    sections: dict[int, list[SectionRef]] = {category_id: [] for category_id in ids}
    for category_id, section_id, title in db.execute(
            select(SectionSkillCategory.category_id, Section.id, Section.title)
            .join(Section, Section.id == SectionSkillCategory.section_id)
            .where(SectionSkillCategory.category_id.in_(ids))
            .order_by(Section.id)):
        sections[category_id].append(SectionRef(id=section_id, title=title))
    used_by = uses(db, CATEGORY_LINKS, ids)
    return [CategoryOut(category_id=category.category_id, category_name=category.category_name,
                        built_in=category.account_id is None, skills=skills[category.category_id],
                        sections=sections[category.category_id],
                        used_by=used_by[category.category_id])
            for category in categories]


def one_out(db: Session, category: SkillCategory, account_id: int) -> CategoryOut:
    return to_out(db, [category], account_id)[0]


def uncategorized(db: Session, skill_ids: list[int]) -> list[int]:
    """The skills no category lists, in the order given."""
    listed = set(db.scalars(select(SkillCategorySkill.skill_id)
                            .where(SkillCategorySkill.skill_id.in_(skill_ids))))
    return [skill_id for skill_id in skill_ids if skill_id not in listed]


@router.get("")
def list_categories(db: DbSession, account_id: AccountId) -> list[CategoryOut]:
    """"Other" first, then the account's categories by name."""
    categories = db.scalars(
        select(SkillCategory)
        .where(or_(SkillCategory.account_id == account_id, SkillCategory.account_id.is_(None)))
        .order_by(SkillCategory.account_id.is_not(None), func.lower(SkillCategory.category_name))
    ).all()
    return to_out(db, list(categories), account_id)


@router.get("/{category_id}")
def get_one(category_id: int, db: DbSession, account_id: AccountId) -> CategoryOut:
    return one_out(db, get_category(db, category_id, account_id), account_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_category(body: NewCategory, db: DbSession, account_id: AccountId) -> CategoryOut:
    check_unique_name(db, SkillCategory.category_name, account_id, body.category_name,
                      "skill category")
    if body.section_id is not None:
        get_section(db, body.section_id, account_id)
    category = SkillCategory(account_id=account_id, category_name=body.category_name)
    db.add(category)
    db.flush()
    if body.section_id is not None:
        append(db, SectionSkillCategory, "section_id", body.section_id, "category_id",
               category.category_id)
    return one_out(db, category, account_id)


@router.put("/{category_id}")
def rename_category(category_id: int, body: CategoryIn, db: DbSession,
                    account_id: AccountId) -> CategoryOut:
    """Renames the category, unless a sent version uses it.

    Then the new name is saved as a new category, listed right after the original in its
    sections and listing the same skills, and unsent resumes and cover letters switch to it.
    The response's category_id differs from the one in the url then.
    """
    category = get_category(db, category_id, account_id)
    if category.category_name == body.category_name:
        return one_out(db, category, account_id)
    protect_other(category, "renamed")
    check_unique_name(db, SkillCategory.category_name, account_id, body.category_name,
                      "skill category", exclude=SkillCategory.category_id != category_id)
    if not used_by_sent_version(db, CATEGORY_LINKS, category_id):
        category.category_name = body.category_name
        db.flush()
        db.refresh(category)
        return one_out(db, category, account_id)

    replacement = SkillCategory(account_id=account_id, category_name=body.category_name)
    db.add(replacement)
    db.flush()
    new_id = replacement.category_id
    list_beside(db, SectionSkillCategory, "section_id", "category_id", category_id, new_id)
    copy_children(db, SkillCategorySkill, "category_id", category_id, new_id)
    switch_unsent(db, CATEGORY_LINKS, category_id, new_id)
    return one_out(db, replacement, account_id)


@router.put("/{category_id}/skills")
def set_category_skills(category_id: int, body: SkillList, db: DbSession,
                        account_id: AccountId) -> CategoryOut:
    """Replaces the skills the category lists, in order.

    A skill taken out of its only category is listed under "Other" instead.
    """
    category = get_category(db, category_id, account_id)
    check_ids(db, Skill, Skill.skill_id, body.skill_ids, account_id, field="skill_ids")
    visible = own_skills(account_id)
    removed = [skill_id for skill_id in db.scalars(
        select(SkillCategorySkill.skill_id)
        .where(SkillCategorySkill.category_id == category_id,
               SkillCategorySkill.skill_id.in_(visible))
        .order_by(SkillCategorySkill.position)) if skill_id not in body.skill_ids]
    set_children(db, SkillCategorySkill, "category_id", category_id, "skill_id", body.skill_ids,
                 visible=visible)
    stranded = uncategorized(db, removed)
    if stranded and category_id == OTHER_CATEGORY_ID:
        names = db.scalars(select(Skill.skill_name).where(Skill.skill_id.in_(stranded)))
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       f"No other category lists {', '.join(names)}. Add it to another category "
                       "before taking it out of \"Other\".", field="skill_ids")
    for skill_id in stranded:
        append(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id", skill_id)
    return one_out(db, category, account_id)


def move_selections_to_other(db: Session, category_id: int, category_model, skill_model,
                             section_model, doc) -> None:
    """Steps 2 to 4 of "Deleting a skill category", for resumes or for cover letters."""
    selection_key = category_model.__table__.primary_key.columns[0].key
    section_key = section_model.__table__.primary_key.columns[0].key
    skill_parent = getattr(skill_model, selection_key)
    section_ids: set[int] = set()
    for selection in db.scalars(select(category_model)
                                .where(category_model.category_id == category_id)).all():
        section_id = getattr(selection, section_key)
        other = db.scalars(select(category_model).where(
            getattr(category_model, section_key) == section_id,
            category_model.category_id == OTHER_CATEGORY_ID)).first()
        if other is None:
            other = category_model(category_id=OTHER_CATEGORY_ID, position=selection.position,
                                   **{section_key: section_id})
            db.add(other)
            db.flush()
        other_id = getattr(other, selection_key)
        already = set(db.scalars(select(skill_model.skill_id).where(skill_parent == other_id)))
        last = db.scalar(select(func.max(skill_model.position))
                         .where(skill_parent == other_id)) or 0
        for chosen in db.scalars(select(skill_model)
                                 .where(skill_parent == getattr(selection, selection_key))
                                 .order_by(skill_model.position)).all():
            if chosen.skill_id in already:
                continue  # already shown under "Other"; deleted along with the category
            last += 1
            setattr(chosen, selection_key, other_id)
            chosen.position = last
        section_ids.add(section_id)
    db.flush()
    if section_ids:
        doc_key = doc.__table__.primary_key.columns[0].key
        docs = select(getattr(section_model, doc_key)).where(
            getattr(section_model, section_key).in_(section_ids))
        touch(db, doc, set(db.scalars(docs)))


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: DbSession, account_id: AccountId) -> None:
    """Moves its skills and selections under "Other", then deletes it, in one transaction."""
    category = get_category(db, category_id, account_id)
    protect_other(category, "deleted")
    skill_ids = list(db.scalars(select(SkillCategorySkill.skill_id)
                                .where(SkillCategorySkill.category_id == category_id)
                                .order_by(SkillCategorySkill.position)))
    only_here = [skill_id for skill_id in skill_ids if not db.scalar(select(exists().where(
        SkillCategorySkill.skill_id == skill_id, SkillCategorySkill.category_id != category_id)))]
    for skill_id in only_here:
        append(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id", skill_id)
    move_selections_to_other(db, category_id, ResumeSkillCategory, ResumeSkill, ResumeSection,
                             Resume)
    move_selections_to_other(db, category_id, CoverLetterSkillCategory, CoverLetterSkill,
                             CoverLetterSection, CoverLetter)
    db.delete(category)
