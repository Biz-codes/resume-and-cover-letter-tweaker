"""Experience (roles) and the bullets each one lists.

A role's row lists every bullet that can go under it. A resume or cover letter stores only
which role and bullets it picked (resume_experience, resume_bullet_point, and the cover letter
tables), and prints everything about the role itself (role_title, organization, location, dates)
from this row. So changing a role's fields follows "Changing a role or project" in
docs/FRONTEND_CHECKS.md:

- A sent version never changes: if one uses the role, the change is saved as a new row.
- Resumes and cover letters in progress change only if the user says to apply it to them
  (apply_to_unsent); otherwise the change is saved as a new row and they keep the original.
- A new row is listed right after the original in its sections and lists the same bullets,
  so they're stored once. Otherwise the row is edited in place.
"""

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.library import append, check_ids, copy_children, list_beside, set_children
from app.models import (
    EXPERIENCE_SECTION_ID,
    BulletPoint,
    Experience,
    ExperienceBulletPoint,
    SectionExperience,
)
from app.refs import BulletRef, SectionRef, bullet_refs, section_refs
from app.routers.sections import get_section
from app.schemas import OptionalText, RequiredText
from app.usage import EXPERIENCE_LINKS, Use, switch_unsent, uses

router = APIRouter(prefix="/api/experience", tags=["experience"])


class ExperienceIn(BaseModel):
    role_title: RequiredText(100)
    organization: RequiredText(100)
    location: OptionalText(100)
    dates: OptionalText(50)


class NewExperience(ExperienceIn):
    # The section that lists the new role: "Experience" unless the user picks another,
    # or none (null).
    section_id: int | None = EXPERIENCE_SECTION_ID


class ExperienceChange(ExperienceIn):
    # Whether resumes and cover letters in progress that use the role get the change.
    apply_to_unsent: bool = False


class ExperienceOut(ExperienceIn):
    experience_id: int
    bullets: list[BulletRef]
    sections: list[SectionRef]
    used_by: list[Use]


class BulletList(BaseModel):
    bullet_ids: list[int]


FIELDS = list(ExperienceIn.model_fields)


def to_out(db: Session, roles: list[Experience], account_id: int) -> list[ExperienceOut]:
    ids = [role.experience_id for role in roles]
    bullets = bullet_refs(db, ExperienceBulletPoint, "experience_id", ids, account_id)
    sections = section_refs(db, SectionExperience, "experience_id", ids)
    used_by = uses(db, EXPERIENCE_LINKS, ids)
    return [ExperienceOut(experience_id=experience.experience_id,
                          bullets=bullets[experience.experience_id],
                          sections=sections[experience.experience_id],
                          used_by=used_by[experience.experience_id],
                          **{field: getattr(experience, field) for field in FIELDS})
            for experience in roles]


def one_out(db: Session, experience: Experience, account_id: int) -> ExperienceOut:
    return to_out(db, [experience], account_id)[0]


def new_version(db: Session, original: Experience, body: ExperienceIn,
                account_id: int) -> Experience:
    """A new row with these values, listed right after the original in its sections and
    listing the same bullets."""
    version = Experience(account_id=account_id, **body.model_dump())
    db.add(version)
    db.flush()
    list_beside(db, SectionExperience, "section_id", "experience_id", original.experience_id,
                version.experience_id)
    copy_children(db, ExperienceBulletPoint, "experience_id", original.experience_id,
                  version.experience_id)
    return version


@router.get("")
def list_experience(db: DbSession, account_id: AccountId) -> list[ExperienceOut]:
    """By organization, then title, so versions of a role sit together, oldest first."""
    roles = db.scalars(
        select(Experience).where(Experience.account_id == account_id)
        .order_by(func.lower(Experience.organization), func.lower(Experience.role_title),
                  Experience.experience_id)
    ).all()
    return to_out(db, list(roles), account_id)


@router.get("/{experience_id}")
def get_one(experience_id: int, db: DbSession, account_id: AccountId) -> ExperienceOut:
    return one_out(db, get_owned(db, Experience, experience_id, account_id), account_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_experience(body: NewExperience, db: DbSession,
                      account_id: AccountId) -> ExperienceOut:
    if body.section_id is not None:
        get_section(db, body.section_id, account_id)
    experience = Experience(account_id=account_id,
                            **body.model_dump(include=set(FIELDS)))
    db.add(experience)
    db.flush()
    if body.section_id is not None:
        append(db, SectionExperience, "section_id", body.section_id, "experience_id",
               experience.experience_id)
    return one_out(db, experience, account_id)


@router.post("/{experience_id}/versions", status_code=status.HTTP_201_CREATED)
def add_version(experience_id: int, body: ExperienceIn, response: Response, db: DbSession,
                account_id: AccountId) -> ExperienceOut:
    """Adds another version of the role on purpose, sharing its bullets.

    Nothing switches to it. With nothing changed, the original is returned (status 200)
    instead of adding a copy.
    """
    original = get_owned(db, Experience, experience_id, account_id)
    if all(getattr(original, field) == getattr(body, field) for field in FIELDS):
        response.status_code = status.HTTP_200_OK
        return one_out(db, original, account_id)
    return one_out(db, new_version(db, original, body, account_id), account_id)


@router.put("/{experience_id}")
def update_experience(experience_id: int, body: ExperienceChange, db: DbSession,
                      account_id: AccountId) -> ExperienceOut:
    """Changes the role's fields (see the module docstring for when that's a new row).

    The response's experience_id differs from the one in the url when a new row was saved.
    """
    role = get_owned(db, Experience, experience_id, account_id)
    values = ExperienceIn(**body.model_dump(include=set(FIELDS)))
    if all(getattr(role, field) == getattr(values, field) for field in FIELDS):
        return one_out(db, role, account_id)
    used_by = uses(db, EXPERIENCE_LINKS, [experience_id])[experience_id]
    sent = any(use.locked for use in used_by)
    in_progress = any(not use.locked for use in used_by)
    if not sent and (body.apply_to_unsent or not in_progress):
        for field in FIELDS:
            setattr(role, field, getattr(values, field))
        db.flush()
        db.refresh(role)
        return one_out(db, role, account_id)

    replacement = new_version(db, role, values, account_id)
    if body.apply_to_unsent:
        switch_unsent(db, EXPERIENCE_LINKS, experience_id, replacement.experience_id)
    return one_out(db, replacement, account_id)


@router.put("/{experience_id}/bullets")
def set_bullets(experience_id: int, body: BulletList, db: DbSession,
                account_id: AccountId) -> ExperienceOut:
    """Replaces the bullets the role lists, in order. Bullets taken out stay in the library."""
    experience = get_owned(db, Experience, experience_id, account_id)
    check_ids(db, BulletPoint, BulletPoint.bullet_id, body.bullet_ids, account_id,
              field="bullet_ids")
    set_children(db, ExperienceBulletPoint, "experience_id", experience_id, "bullet_id",
                 body.bullet_ids)
    return one_out(db, experience, account_id)


@router.delete("/{experience_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_experience(experience_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it, and the bullets under it, from every resume and cover letter. The
    bullets stay in the library."""
    db.delete(get_owned(db, Experience, experience_id, account_id))
