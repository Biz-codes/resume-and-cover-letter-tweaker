"""Projects, and the skills and bullets each one lists.

A project's row lists every skill and bullet that can go under it. A resume or cover letter
stores only which project, skills, and bullets it picked (resume_project,
resume_project_skill, resume_bullet_point, and the cover letter tables), and prints
everything about the project itself (project_title, done_for, url, dates) from this row. So
changing a project's fields follows "Changing a role or project" in docs/FRONTEND_CHECKS.md:

- A sent version never changes: if one uses the project, the change is saved as a new row.
- Resumes and cover letters in progress change only if the user says to apply it to them
  (apply_to_unsent); otherwise the change is saved as a new row and they keep the original.
- A new row is listed right after the original in its sections and lists the same skills
  and bullets. Otherwise the row is edited in place.
"""

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.library import append, check_ids, copy_children, list_beside, set_children
from app.models import (
    PROJECTS_SECTION_ID,
    BulletPoint,
    Project,
    ProjectBulletPoint,
    ProjectSkill,
    SectionProject,
    Skill,
)
from app.refs import BulletRef, SectionRef, bullet_refs, section_refs
from app.routers.sections import get_section
from app.schemas import OptionalText, RequiredText
from app.usage import PROJECT_LINKS, Use, switch_unsent, uses

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    project_title: RequiredText(100)
    done_for: OptionalText(100)
    url: OptionalText()
    dates: OptionalText(50)


class NewProject(ProjectIn):
    # The section that lists the new project: "Projects" unless the user picks another,
    # or none (null).
    section_id: int | None = PROJECTS_SECTION_ID


class SkillRef(BaseModel):
    skill_id: int
    skill_name: str


class ProjectChange(ProjectIn):
    # Whether resumes and cover letters in progress that use the project get the change.
    apply_to_unsent: bool = False


class ProjectOut(ProjectIn):
    project_id: int
    skills: list[SkillRef]
    bullets: list[BulletRef]
    sections: list[SectionRef]
    used_by: list[Use]


class SkillList(BaseModel):
    skill_ids: list[int]


class BulletList(BaseModel):
    bullet_ids: list[int]


FIELDS = list(ProjectIn.model_fields)


def to_out(db: Session, projects: list[Project], account_id: int) -> list[ProjectOut]:
    ids = [project.project_id for project in projects]
    skills: dict[int, list[SkillRef]] = {project_id: [] for project_id in ids}
    for project_id, skill_id, name in db.execute(
            select(ProjectSkill.project_id, Skill.skill_id, Skill.skill_name)
            .join(Skill, Skill.skill_id == ProjectSkill.skill_id)
            .where(ProjectSkill.project_id.in_(ids))
            .order_by(ProjectSkill.position)):
        skills[project_id].append(SkillRef(skill_id=skill_id, skill_name=name))
    bullets = bullet_refs(db, ProjectBulletPoint, "project_id", ids, account_id)
    sections = section_refs(db, SectionProject, "project_id", ids)
    used_by = uses(db, PROJECT_LINKS, ids)
    return [ProjectOut(project_id=project.project_id, skills=skills[project.project_id],
                       bullets=bullets[project.project_id],
                       sections=sections[project.project_id],
                       used_by=used_by[project.project_id],
                       **{field: getattr(project, field) for field in FIELDS})
            for project in projects]


def one_out(db: Session, project: Project, account_id: int) -> ProjectOut:
    return to_out(db, [project], account_id)[0]


def new_version(db: Session, original: Project, body: ProjectIn, account_id: int) -> Project:
    """A new row with these values, listed right after the original in its sections and
    listing the same skills and bullets."""
    version = Project(account_id=account_id, **body.model_dump())
    db.add(version)
    db.flush()
    list_beside(db, SectionProject, "section_id", "project_id", original.project_id,
                version.project_id)
    for link in (ProjectSkill, ProjectBulletPoint):
        copy_children(db, link, "project_id", original.project_id, version.project_id)
    return version


@router.get("")
def list_projects(db: DbSession, account_id: AccountId) -> list[ProjectOut]:
    """By title, so versions of a project sit together, oldest first."""
    projects = db.scalars(
        select(Project).where(Project.account_id == account_id)
        .order_by(func.lower(Project.project_title), Project.project_id)
    ).all()
    return to_out(db, list(projects), account_id)


@router.get("/{project_id}")
def get_one(project_id: int, db: DbSession, account_id: AccountId) -> ProjectOut:
    return one_out(db, get_owned(db, Project, project_id, account_id), account_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(body: NewProject, db: DbSession, account_id: AccountId) -> ProjectOut:
    if body.section_id is not None:
        get_section(db, body.section_id, account_id)
    project = Project(account_id=account_id, **body.model_dump(include=set(FIELDS)))
    db.add(project)
    db.flush()
    if body.section_id is not None:
        append(db, SectionProject, "section_id", body.section_id, "project_id",
               project.project_id)
    return one_out(db, project, account_id)


@router.post("/{project_id}/versions", status_code=status.HTTP_201_CREATED)
def add_version(project_id: int, body: ProjectIn, response: Response, db: DbSession,
                account_id: AccountId) -> ProjectOut:
    """Adds another version of the project on purpose, sharing its skills and bullets.

    Nothing switches to it. With nothing changed, the original is returned (status 200)
    instead of adding a copy.
    """
    original = get_owned(db, Project, project_id, account_id)
    if all(getattr(original, field) == getattr(body, field) for field in FIELDS):
        response.status_code = status.HTTP_200_OK
        return one_out(db, original, account_id)
    return one_out(db, new_version(db, original, body, account_id), account_id)


@router.put("/{project_id}")
def update_project(project_id: int, body: ProjectChange, db: DbSession,
                      account_id: AccountId) -> ProjectOut:
    """Changes the project's fields (see the module docstring for when that's a new row).

    The response's project_id differs from the one in the url when a new row was saved.
    """
    project = get_owned(db, Project, project_id, account_id)
    values = ProjectIn(**body.model_dump(include=set(FIELDS)))
    if all(getattr(project, field) == getattr(values, field) for field in FIELDS):
        return one_out(db, project, account_id)
    used_by = uses(db, PROJECT_LINKS, [project_id])[project_id]
    sent = any(use.locked for use in used_by)
    in_progress = any(not use.locked for use in used_by)
    if not sent and (body.apply_to_unsent or not in_progress):
        for field in FIELDS:
            setattr(project, field, getattr(values, field))
        db.flush()
        db.refresh(project)
        return one_out(db, project, account_id)

    replacement = new_version(db, project, values, account_id)
    if body.apply_to_unsent:
        switch_unsent(db, PROJECT_LINKS, project_id, replacement.project_id)
    return one_out(db, replacement, account_id)


@router.put("/{project_id}/skills")
def set_skills(project_id: int, body: SkillList, db: DbSession,
               account_id: AccountId) -> ProjectOut:
    """Replaces the skills the project lists, in order. Resumes and cover letters keep the
    skills they show for it."""
    project = get_owned(db, Project, project_id, account_id)
    check_ids(db, Skill, Skill.skill_id, body.skill_ids, account_id, field="skill_ids")
    set_children(db, ProjectSkill, "project_id", project_id, "skill_id", body.skill_ids)
    return one_out(db, project, account_id)


@router.put("/{project_id}/bullets")
def set_bullets(project_id: int, body: BulletList, db: DbSession,
                account_id: AccountId) -> ProjectOut:
    """Replaces the bullets the project lists, in order. Bullets taken out stay in the
    library."""
    project = get_owned(db, Project, project_id, account_id)
    check_ids(db, BulletPoint, BulletPoint.bullet_id, body.bullet_ids, account_id,
              field="bullet_ids")
    set_children(db, ProjectBulletPoint, "project_id", project_id, "bullet_id",
                 body.bullet_ids)
    return one_out(db, project, account_id)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it, and the bullets and skills under it, from every resume and cover letter.
    The bullets and skills stay in the library."""
    db.delete(get_owned(db, Project, project_id, account_id))
