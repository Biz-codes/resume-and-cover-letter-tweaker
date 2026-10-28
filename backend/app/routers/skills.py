"""Skills. Each one is listed under at least one category, and under any projects that used it.

Renaming a skill that a sent version uses saves a new skill (docs/FRONTEND_CHECKS.md, "Sent
versions are locked").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.library import append, check_unique_name, list_beside
from app.models import (
    OTHER_CATEGORY_ID,
    Project,
    ProjectSkill,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)
from app.refs import ProjectRef
from app.routers.skill_categories import get_category
from app.schemas import RequiredText
from app.usage import SKILL_LINKS, Use, switch_unsent, used_by_sent_version, uses

router = APIRouter(prefix="/api/skills", tags=["skills"])


class SkillIn(BaseModel):
    skill_name: RequiredText(100)


class NewSkill(SkillIn):
    # The category that lists the new skill: "Other" unless the user picks another.
    category_id: int = OTHER_CATEGORY_ID


class CategoryRef(BaseModel):
    category_id: int
    category_name: str


class SkillOut(BaseModel):
    skill_id: int
    skill_name: str
    categories: list[CategoryRef]
    projects: list[ProjectRef]
    used_by: list[Use]


def to_out(db: Session, skills: list[Skill]) -> list[SkillOut]:
    ids = [skill.skill_id for skill in skills]
    categories: dict[int, list[CategoryRef]] = {skill_id: [] for skill_id in ids}
    for skill_id, category_id, name in db.execute(
            select(SkillCategorySkill.skill_id, SkillCategory.category_id,
                   SkillCategory.category_name)
            .join(SkillCategory, SkillCategory.category_id == SkillCategorySkill.category_id)
            .where(SkillCategorySkill.skill_id.in_(ids))
            .order_by(SkillCategory.account_id.is_not(None), SkillCategory.category_name)):
        categories[skill_id].append(CategoryRef(category_id=category_id, category_name=name))
    projects: dict[int, list[ProjectRef]] = {skill_id: [] for skill_id in ids}
    for skill_id, project_id, title, done_for in db.execute(
            select(ProjectSkill.skill_id, Project.project_id, Project.project_title,
                   Project.done_for)
            .join(Project, Project.project_id == ProjectSkill.project_id)
            .where(ProjectSkill.skill_id.in_(ids))
            .order_by(Project.project_title, Project.project_id)):
        projects[skill_id].append(ProjectRef(project_id=project_id, project_title=title,
                                             done_for=done_for))
    used_by = uses(db, SKILL_LINKS, ids)
    return [SkillOut(skill_id=skill.skill_id, skill_name=skill.skill_name,
                     categories=categories[skill.skill_id], projects=projects[skill.skill_id],
                     used_by=used_by[skill.skill_id])
            for skill in skills]


def one_out(db: Session, skill: Skill) -> SkillOut:
    return to_out(db, [skill])[0]


@router.get("")
def list_skills(db: DbSession, account_id: AccountId) -> list[SkillOut]:
    skills = db.scalars(select(Skill).where(Skill.account_id == account_id)
                        .order_by(func.lower(Skill.skill_name))).all()
    return to_out(db, list(skills))


@router.get("/{skill_id}")
def get_one(skill_id: int, db: DbSession, account_id: AccountId) -> SkillOut:
    return one_out(db, get_owned(db, Skill, skill_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_skill(body: NewSkill, db: DbSession, account_id: AccountId) -> SkillOut:
    check_unique_name(db, Skill.skill_name, account_id, body.skill_name, "skill")
    get_category(db, body.category_id, account_id)
    skill = Skill(account_id=account_id, skill_name=body.skill_name)
    db.add(skill)
    db.flush()
    append(db, SkillCategorySkill, "category_id", body.category_id, "skill_id", skill.skill_id)
    return one_out(db, skill)


@router.put("/{skill_id}")
def rename_skill(skill_id: int, body: SkillIn, db: DbSession, account_id: AccountId) -> SkillOut:
    """Renames the skill, unless a sent version uses it.

    Then the new name is saved as a new skill, listed right after the original in every
    category and project, and unsent resumes and cover letters switch to it. The response's
    skill_id differs from the one in the url then.
    """
    skill = get_owned(db, Skill, skill_id, account_id)
    if skill.skill_name == body.skill_name:
        return one_out(db, skill)
    check_unique_name(db, Skill.skill_name, account_id, body.skill_name, "skill",
                      exclude=Skill.skill_id != skill_id)
    if not used_by_sent_version(db, SKILL_LINKS, skill_id):
        skill.skill_name = body.skill_name
        db.flush()
        db.refresh(skill)
        return one_out(db, skill)

    replacement = Skill(account_id=account_id, skill_name=body.skill_name)
    db.add(replacement)
    db.flush()
    new_id = replacement.skill_id
    list_beside(db, SkillCategorySkill, "category_id", "skill_id", skill_id, new_id)
    list_beside(db, ProjectSkill, "project_id", "skill_id", skill_id, new_id)
    switch_unsent(db, SKILL_LINKS, skill_id, new_id)
    return one_out(db, replacement)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it from every category, project, resume, and cover letter."""
    db.delete(get_owned(db, Skill, skill_id, account_id))
