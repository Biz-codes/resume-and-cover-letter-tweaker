"""Headers: the name, headline, and contact details at the top of a resume or cover letter.

Headers have versions (docs/FRONTEND_CHECKS.md, "Headers"), and editing one follows
"Changing an item": sent versions and applied postings never change, and the postings and base
resumes and cover letters in progress change only if the user picks them (apply_to; a
posting's resumes and cover letters always share its header). Unless every one is picked and
nothing sent uses it, the new values are saved as a new header, and only the picked ones switch
to it. Identical headers are reused, never duplicated.
"""

from datetime import datetime

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.hiding import HiddenIn, refuse_delete_if_sent, set_hidden
from app.models import CoverLetter, Header, JobPosting, Resume
from app.schemas import OptionalText, RequiredText
from app.usage import Use, UseRef, edit_choice
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


class HeaderChange(HeaderIn):
    # The postings and base resumes and cover letters in progress that get the change; the rest
    # keep the original.
    apply_to: list[UseRef] = []


class HeaderOut(HeaderIn):
    header_id: int
    hidden: bool
    # When it was added, which tells versions apart in lists when all else they show matches.
    created_at: datetime
    used_by: list[Use]
    # What an edit can be applied to: the postings in progress and the base resumes and cover
    # letters that use it (a posting's resumes and cover letters go with the posting).
    in_progress: list[Use]


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


def bases(db: Session, account_id: int) -> set[tuple[str, int]]:
    """The account's base resumes and cover letters (no posting), by kind and id."""
    return ({("resume", doc) for doc in db.scalars(
                select(Resume.resume_id).where(Resume.account_id == account_id,
                                               Resume.job_posting_id.is_(None)))}
            | {("cover_letter", doc) for doc in db.scalars(
                select(CoverLetter.letter_id).where(CoverLetter.account_id == account_id,
                                                    CoverLetter.job_posting_id.is_(None)))})


def in_progress(used_by: list[Use], base: set[tuple[str, int]]) -> list[Use]:
    return [use for use in used_by if not use.locked
            and (use.kind == "job_posting" or (use.kind, use.id) in base)]


def to_out(header: Header, used_by: list[Use], base: set[tuple[str, int]]) -> HeaderOut:
    return HeaderOut(header_id=header.header_id,
                     hidden=header.hidden, created_at=header.created_at, used_by=used_by,
                     in_progress=in_progress(used_by, base),
                     **{field: getattr(header, field) for field in FIELDS})


def one_out(db: Session, header: Header) -> HeaderOut:
    return to_out(header, uses(db, [header.header_id])[header.header_id],
                  bases(db, header.account_id))


def find_identical(db: Session, account_id: int, values: HeaderIn) -> Header | None:
    return db.scalars(
        select(Header)
        .where(Header.account_id == account_id,
               *(getattr(Header, field).is_not_distinct_from(getattr(values, field))
                 for field in FIELDS))
        .order_by(Header.header_id)
        .limit(1)
    ).first()


def find_or_add(db: Session, account_id: int, values: HeaderIn) -> tuple[Header, bool]:
    """The header with exactly these values, added if there's none. True when it was added."""
    existing = find_identical(db, account_id, values)
    if existing is not None:
        return existing, False
    header = Header(account_id=account_id, **values.model_dump(include=set(FIELDS)))
    db.add(header)
    db.flush()
    return header, True


def switch(db: Session, chosen: set[tuple[str, int]], header_id: int) -> None:
    """Points the chosen postings (with their resumes and cover letters) and base resumes and
    cover letters at the header."""
    postings = [item for kind, item in chosen if kind == "job_posting"]
    for model, pk, kind in ((Resume, Resume.resume_id, "resume"),
                            (CoverLetter, CoverLetter.letter_id, "cover_letter")):
        picked = [item for k, item in chosen if k == kind]
        db.execute(update(model)
                   .where(or_(pk.in_(picked), model.job_posting_id.in_(postings)))
                   .values(header_id=header_id))
    db.execute(update(JobPosting).where(JobPosting.job_posting_id.in_(postings))
               .values(header_id=header_id))


@router.get("")
def list_headers(db: DbSession, account_id: AccountId) -> list[HeaderOut]:
    headers = db.scalars(
        select(Header).where(Header.account_id == account_id)
        .order_by(Header.updated_at.desc(), Header.header_id.desc())
    ).all()
    found = uses(db, [header.header_id for header in headers])
    base = bases(db, account_id)
    return [to_out(header, found[header.header_id], base) for header in headers]


@router.get("/{header_id}")
def get_header(header_id: int, db: DbSession, account_id: AccountId) -> HeaderOut:
    return one_out(db, get_owned(db, Header, header_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_header(body: HeaderIn, response: Response, db: DbSession,
                  account_id: AccountId) -> HeaderOut:
    """Adds a header, or returns the identical one that already exists (status 200)."""
    header, added = find_or_add(db, account_id, body)
    if not added:
        response.status_code = status.HTTP_200_OK
    return one_out(db, header)


@router.post("/{header_id}/versions", status_code=status.HTTP_201_CREATED)
def add_version(header_id: int, body: HeaderIn, response: Response, db: DbSession,
                account_id: AccountId) -> HeaderOut:
    """Adds another version of the header on purpose. Nothing switches to it. When a header
    with exactly these values exists (the original, with nothing changed), it's returned
    (status 200) instead."""
    get_owned(db, Header, header_id, account_id)
    return create_header(body, response, db, account_id)


@router.put("/{header_id}")
def update_header(header_id: int, body: HeaderChange, db: DbSession,
                  account_id: AccountId) -> HeaderOut:
    """Changes the header's values (see the module docstring for when that's a new header, or
    an identical one reused).

    The response's header_id differs from the one in the url when that happens.
    """
    header = get_owned(db, Header, header_id, account_id)
    values = HeaderIn(**body.model_dump(include=set(FIELDS)))
    if all(getattr(header, field) == getattr(values, field) for field in FIELDS):
        return one_out(db, header)
    used_by = uses(db, [header_id])[header_id]
    in_place, chosen = edit_choice(used_by, body.apply_to,
                                   offered=in_progress(used_by, bases(db, account_id)))
    if in_place:
        for field in FIELDS:
            setattr(header, field, getattr(values, field))
        db.flush()
        db.refresh(header)
        return one_out(db, header)

    replacement = find_or_add(db, account_id, values)[0]
    if chosen:
        switch(db, chosen, replacement.header_id)
    return one_out(db, replacement)


@router.put("/{header_id}/hidden")
def set_header_hidden(header_id: int, body: HiddenIn, db: DbSession,
                      account_id: AccountId) -> HeaderOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"). Nothing that uses it changes."""
    item = get_owned(db, Header, header_id, account_id)
    set_hidden(db, item, body.hidden)
    return one_out(db, item)


@router.delete("/{header_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_header(header_id: int, db: DbSession, account_id: AccountId) -> None:
    """Postings, resumes, and cover letters that used it keep going with no header."""
    item = get_owned(db, Header, header_id, account_id)
    refuse_delete_if_sent(uses(db, [header_id])[header_id], "header")
    db.delete(item)
