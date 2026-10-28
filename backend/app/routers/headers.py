"""Headers: the name, headline, and contact details at the top of a resume or cover letter.

Headers have versions (docs/FRONTEND_CHECKS.md, "Headers"): editing one that a sent
version uses saves a new header instead, and identical headers are reused, never duplicated.
"""

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.models import CoverLetter, Header, JobPosting, Resume
from app.schemas import OptionalText, RequiredText
from app.usage import Use
from app.versions import is_locked

router = APIRouter(prefix="/api/headers", tags=["headers"])


class HeaderIn(BaseModel):
    full_name: RequiredText(100)
    headline: OptionalText(100)
    email: OptionalText(255)
    phone: OptionalText(50)
    location: OptionalText(100)
    linkedin_url: OptionalText()
    github_url: OptionalText()
    portfolio_url: OptionalText()


class HeaderOut(HeaderIn):
    header_id: int
    used_by: list[Use]


FIELDS = list(HeaderIn.model_fields)


def uses(db: Session, header_ids: list[int]) -> dict[int, list[Use]]:
    found: dict[int, list[Use]] = {header_id: [] for header_id in header_ids}
    queries = [
        ("job_posting", select(JobPosting.header_id, JobPosting.job_posting_id,
                               JobPosting.organization + ": " + JobPosting.role_title,
                               JobPosting.applied_on.is_not(None))),
        ("resume", select(Resume.header_id, Resume.resume_id, Resume.name,
                          is_locked(Resume))),
        ("cover_letter", select(CoverLetter.header_id, CoverLetter.letter_id, CoverLetter.name,
                                is_locked(CoverLetter))),
    ]
    for kind, query in queries:
        header_column = query.selected_columns[0]
        for header_id, item_id, name, locked in db.execute(
            query.where(header_column.in_(header_ids)).order_by(query.selected_columns[1])
        ):
            found[header_id].append(Use(kind=kind, id=item_id, name=name, locked=bool(locked)))
    return found


def to_out(header: Header, used_by: list[Use]) -> HeaderOut:
    return HeaderOut(header_id=header.header_id, used_by=used_by,
                     **{field: getattr(header, field) for field in FIELDS})


def one_out(db: Session, header: Header) -> HeaderOut:
    return to_out(header, uses(db, [header.header_id])[header.header_id])


def find_identical(db: Session, account_id: int, values: HeaderIn) -> Header | None:
    return db.scalars(
        select(Header)
        .where(Header.account_id == account_id,
               *(getattr(Header, field).is_not_distinct_from(getattr(values, field))
                 for field in FIELDS))
        .order_by(Header.header_id)
        .limit(1)
    ).first()


def used_by_sent_version(db: Session, header_id: int) -> bool:
    return any(use.locked for use in uses(db, [header_id])[header_id])


@router.get("")
def list_headers(db: DbSession, account_id: AccountId) -> list[HeaderOut]:
    headers = db.scalars(
        select(Header).where(Header.account_id == account_id)
        .order_by(Header.updated_at.desc(), Header.header_id.desc())
    ).all()
    found = uses(db, [header.header_id for header in headers])
    return [to_out(header, found[header.header_id]) for header in headers]


@router.get("/{header_id}")
def get_header(header_id: int, db: DbSession, account_id: AccountId) -> HeaderOut:
    return one_out(db, get_owned(db, Header, header_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_header(body: HeaderIn, response: Response, db: DbSession,
                  account_id: AccountId) -> HeaderOut:
    """Adds a header, or returns the identical one that already exists (status 200)."""
    existing = find_identical(db, account_id, body)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return one_out(db, existing)
    header = Header(account_id=account_id, **body.model_dump())
    db.add(header)
    db.flush()
    return one_out(db, header)


@router.put("/{header_id}")
def update_header(header_id: int, body: HeaderIn, db: DbSession,
                  account_id: AccountId) -> HeaderOut:
    """Edits the header in place, unless a sent version uses it.

    Then the new values are saved as a new header (or an identical existing one is
    reused), and nothing switches to it: each posting, resume, and cover letter keeps its
    header until the user picks another, since different applications may need different
    headers. The response's header_id differs from the one in the url when that happens.
    """
    header = get_owned(db, Header, header_id, account_id)
    if all(getattr(header, field) == getattr(body, field) for field in FIELDS):
        return one_out(db, header)
    if not used_by_sent_version(db, header_id):
        for field in FIELDS:
            setattr(header, field, getattr(body, field))
        db.flush()
        db.refresh(header)
        return one_out(db, header)

    replacement = find_identical(db, account_id, body)
    if replacement is None:
        replacement = Header(account_id=account_id, **body.model_dump())
        db.add(replacement)
        db.flush()
    return one_out(db, replacement)


@router.delete("/{header_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_header(header_id: int, db: DbSession, account_id: AccountId) -> None:
    """Postings, resumes, and cover letters that used it keep going with no header."""
    db.delete(get_owned(db, Header, header_id, account_id))
