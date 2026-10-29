"""Education entries, and the sections that list each one.

A resume or cover letter stores only which entries it picked (resume_education,
cover_letter_education) and prints the degree, institution, details, and graduation from this
row. So editing an entry a sent version uses saves a new entry, listed right after the
original in its sections; sent versions keep the original and unsent ones switch to the new
one. An entry no sent version uses is edited in place (docs/FRONTEND_CHECKS.md, "Sent
versions are locked").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.library import append, list_beside
from app.models import EDUCATION_SECTION_ID, Education, SectionEducation
from app.refs import SectionRef, section_refs
from app.routers.sections import get_section
from app.schemas import OptionalText, RequiredText
from app.usage import EDUCATION_LINKS, Use, switch_unsent, used_by_sent_version, uses

router = APIRouter(prefix="/api/education", tags=["education"])


class EducationIn(BaseModel):
    degree: RequiredText(100)
    institution: RequiredText(100)
    details: OptionalText()
    graduation: OptionalText(100)


class NewEducation(EducationIn):
    # The section that lists the new entry: "Education" unless the user picks another,
    # or none (null).
    section_id: int | None = EDUCATION_SECTION_ID


class EducationOut(EducationIn):
    education_id: int
    sections: list[SectionRef]
    used_by: list[Use]


FIELDS = list(EducationIn.model_fields)


def to_out(db: Session, entries: list[Education]) -> list[EducationOut]:
    ids = [entry.education_id for entry in entries]
    sections = section_refs(db, SectionEducation, "education_id", ids)
    used_by = uses(db, EDUCATION_LINKS, ids)
    return [EducationOut(education_id=entry.education_id, sections=sections[entry.education_id],
                         used_by=used_by[entry.education_id],
                         **{field: getattr(entry, field) for field in FIELDS})
            for entry in entries]


def one_out(db: Session, entry: Education) -> EducationOut:
    return to_out(db, [entry])[0]


@router.get("")
def list_education(db: DbSession, account_id: AccountId) -> list[EducationOut]:
    """By institution, then degree, so versions of an entry sit together, oldest first."""
    entries = db.scalars(
        select(Education).where(Education.account_id == account_id)
        .order_by(func.lower(Education.institution), func.lower(Education.degree),
                  Education.education_id)
    ).all()
    return to_out(db, list(entries))


@router.get("/{education_id}")
def get_one(education_id: int, db: DbSession, account_id: AccountId) -> EducationOut:
    return one_out(db, get_owned(db, Education, education_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_education(body: NewEducation, db: DbSession, account_id: AccountId) -> EducationOut:
    if body.section_id is not None:
        get_section(db, body.section_id, account_id)
    entry = Education(account_id=account_id, **body.model_dump(include=set(FIELDS)))
    db.add(entry)
    db.flush()
    if body.section_id is not None:
        append(db, SectionEducation, "section_id", body.section_id, "education_id",
               entry.education_id)
    return one_out(db, entry)


@router.put("/{education_id}")
def update_education(education_id: int, body: EducationIn, db: DbSession,
                     account_id: AccountId) -> EducationOut:
    """Edits the entry in place, unless a sent version uses it (see the module docstring).

    The response's education_id differs from the one in the url when a new entry was saved.
    """
    entry = get_owned(db, Education, education_id, account_id)
    if all(getattr(entry, field) == getattr(body, field) for field in FIELDS):
        return one_out(db, entry)
    if not used_by_sent_version(db, EDUCATION_LINKS, education_id):
        for field in FIELDS:
            setattr(entry, field, getattr(body, field))
        db.flush()
        db.refresh(entry)
        return one_out(db, entry)

    replacement = Education(account_id=account_id, **body.model_dump())
    db.add(replacement)
    db.flush()
    list_beside(db, SectionEducation, "section_id", "education_id", education_id,
                replacement.education_id)
    switch_unsent(db, EDUCATION_LINKS, education_id, replacement.education_id)
    return one_out(db, replacement)


@router.delete("/{education_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_education(education_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes it from every section, resume, and cover letter."""
    db.delete(get_owned(db, Education, education_id, account_id))
