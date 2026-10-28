"""Bullet points, and the roles, projects, and sections that list each one.

A bullet is stored once and can be listed under any number of roles, projects, and sections.
A resume or cover letter stores only which bullets it picked (resume_bullet_point,
cover_letter_bullet_point), and they're locked once the posting is applied to; the text is
read from this row.

So nothing printed on a sent version can change: editing a bullet a sent version uses saves
a new bullet, listed right after the original wherever it's listed. Sent versions keep the
original; unsent ones switch to the new one. A bullet no sent version uses is edited in
place (docs/FRONTEND_CHECKS.md, "Sent versions are locked").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.library import append, list_beside
from app.models import (
    BulletPoint,
    Experience,
    ExperienceBulletPoint,
    Project,
    ProjectBulletPoint,
    SectionBulletPoint,
)
from app.refs import (
    ExperienceRef,
    ProjectRef,
    SectionRef,
    experience_refs,
    project_refs,
    section_refs,
)
from app.routers.sections import get_section
from app.schemas import RequiredText
from app.usage import BULLET_LINKS, Use, switch_unsent, used_by_sent_version, uses

router = APIRouter(prefix="/api/bullet-points", tags=["bullet points"])

# Every library list a bullet can be in: (join table, its parent column).
BULLET_LISTS = [(ExperienceBulletPoint, "experience_id"), (ProjectBulletPoint, "project_id"),
                (SectionBulletPoint, "section_id")]


class BulletIn(BaseModel):
    content: RequiredText()


class NewBullet(BulletIn):
    # Where the new bullet is listed (last): under a role, a project, and/or directly in a
    # section. With none, it starts unlisted.
    experience_id: int | None = None
    project_id: int | None = None
    section_id: int | None = None


class BulletOut(BulletIn):
    bullet_id: int
    experience: list[ExperienceRef]
    projects: list[ProjectRef]
    sections: list[SectionRef]
    used_by: list[Use]


def to_out(db: Session, bullets: list[BulletPoint], account_id: int) -> list[BulletOut]:
    ids = [bullet.bullet_id for bullet in bullets]
    experience = experience_refs(db, ExperienceBulletPoint, "bullet_id", ids, account_id,
                                  order_by=Experience.organization)
    projects = project_refs(db, ProjectBulletPoint, "bullet_id", ids, account_id,
                            order_by=Project.project_title)
    sections = section_refs(db, SectionBulletPoint, "bullet_id", ids)
    used_by = uses(db, BULLET_LINKS, ids)
    return [BulletOut(bullet_id=bullet.bullet_id, content=bullet.content,
                      experience=experience[bullet.bullet_id],
                      projects=projects[bullet.bullet_id], sections=sections[bullet.bullet_id],
                      used_by=used_by[bullet.bullet_id])
            for bullet in bullets]


def one_out(db: Session, bullet: BulletPoint, account_id: int) -> BulletOut:
    return to_out(db, [bullet], account_id)[0]


@router.get("")
def list_bullets(db: DbSession, account_id: AccountId) -> list[BulletOut]:
    """Oldest first."""
    bullets = db.scalars(select(BulletPoint).where(BulletPoint.account_id == account_id)
                         .order_by(BulletPoint.bullet_id)).all()
    return to_out(db, list(bullets), account_id)


@router.get("/{bullet_id}")
def get_one(bullet_id: int, db: DbSession, account_id: AccountId) -> BulletOut:
    return one_out(db, get_owned(db, BulletPoint, bullet_id, account_id), account_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_bullet(body: NewBullet, db: DbSession, account_id: AccountId) -> BulletOut:
    if body.experience_id is not None:
        get_owned(db, Experience, body.experience_id, account_id)
    if body.project_id is not None:
        get_owned(db, Project, body.project_id, account_id)
    if body.section_id is not None:
        get_section(db, body.section_id, account_id)
    bullet = BulletPoint(account_id=account_id, content=body.content)
    db.add(bullet)
    db.flush()
    for link, parent_col in BULLET_LISTS:
        parent_id = getattr(body, parent_col)
        if parent_id is not None:
            append(db, link, parent_col, parent_id, "bullet_id", bullet.bullet_id)
    return one_out(db, bullet, account_id)


@router.put("/{bullet_id}")
def update_bullet(bullet_id: int, body: BulletIn, db: DbSession,
                  account_id: AccountId) -> BulletOut:
    """Edits the bullet in place, unless a sent version uses it.

    Then the new text is saved as a new bullet, listed right after the original under every
    role, project, and section, and unsent resumes and cover letters switch to it. The
    response's bullet_id differs from the one in the url then.
    """
    bullet = get_owned(db, BulletPoint, bullet_id, account_id)
    if bullet.content == body.content:
        return one_out(db, bullet, account_id)
    if not used_by_sent_version(db, BULLET_LINKS, bullet_id):
        bullet.content = body.content
        db.flush()
        db.refresh(bullet)
        return one_out(db, bullet, account_id)

    replacement = BulletPoint(account_id=account_id, content=body.content)
    db.add(replacement)
    db.flush()
    for link, parent_col in BULLET_LISTS:
        list_beside(db, link, parent_col, "bullet_id", bullet_id, replacement.bullet_id)
    switch_unsent(db, BULLET_LINKS, bullet_id, replacement.bullet_id)
    return one_out(db, replacement, account_id)


@router.delete("/{bullet_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bullet(bullet_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it from every role, project, section, resume, and cover letter."""
    db.delete(get_owned(db, BulletPoint, bullet_id, account_id))
