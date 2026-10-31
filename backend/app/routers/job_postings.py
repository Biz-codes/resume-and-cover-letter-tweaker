"""Job postings, entered by hand from a pasted description: list, read, create, edit, pick the
header, and delete.

Everything for an application hangs off its posting (docs/APP_FLOW.md, "User flow"): its
header, which all its resumes and cover letters use, and those versions themselves,
which are started from app/routers/resumes.py and cover_letters.py with a job_posting_id.
Fetching a posting from its url comes in phase 5; tracking the application (applied date,
contacts, interviews) in the next step.
"""

from datetime import date, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.documents import latest_header_id
from app.errors import AppError, ErrorCode
from app.models import CoverLetter, Header, Interview, JobPosting, JobPostingInterview, Resume
from app.routers.headers import FIELDS as HEADER_FIELDS
from app.routers.headers import HeaderIn, find_identical
from app.schemas import RequiredText
from app.usage import Use

router = APIRouter(prefix="/api/job-postings", tags=["job postings"])


class PostingIn(BaseModel):
    url: RequiredText()
    organization: RequiredText(100)
    role_title: RequiredText(100)
    description: RequiredText()


class PostingOut(PostingIn):
    job_posting_id: int
    header_id: int | None
    applied_on: date | None
    # Applied to: its resumes and cover letters are a record of what was sent.
    locked: bool
    # Its resumes, then its cover letters, oldest first.
    versions: list[Use]
    updated_at: datetime | None


class PostingDetail(PostingOut):
    # Until the posting has a header: the values to suggest (docs/FRONTEND_CHECKS.md, "Headers").
    suggested_header: HeaderIn | None
    # Interviews no other posting is linked to, which deleting the posting deletes too.
    lone_interviews: int


FIELDS = list(PostingIn.model_fields)


def versions(db: Session, posting_ids: list[int], locked: dict[int, bool]) -> dict[int, list[Use]]:
    found: dict[int, list[Use]] = {posting_id: [] for posting_id in posting_ids}
    for kind, model, pk in (("resume", Resume, Resume.resume_id),
                            ("cover_letter", CoverLetter, CoverLetter.letter_id)):
        for posting_id, doc_id, name in db.execute(
                select(model.job_posting_id, pk, model.name)
                .where(model.job_posting_id.in_(posting_ids)).order_by(pk)):
            found[posting_id].append(Use(kind=kind, id=doc_id, name=name,
                                         locked=locked[posting_id]))
    return found


def to_out(db: Session, postings: list[JobPosting]) -> list[PostingOut]:
    locked = {posting.job_posting_id: posting.applied_on is not None for posting in postings}
    found = versions(db, list(locked), locked)
    return [PostingOut(job_posting_id=posting.job_posting_id, header_id=posting.header_id,
                       applied_on=posting.applied_on, locked=locked[posting.job_posting_id],
                       versions=found[posting.job_posting_id], updated_at=posting.updated_at,
                       **{name: getattr(posting, name) for name in FIELDS})
            for posting in postings]


def lone_interviews(db: Session, posting_id: int) -> list[int]:
    """The interviews linked to this posting and no other."""
    links = JobPostingInterview
    shared = (select(links.interview_id).group_by(links.interview_id)
              .having(func.count() > 1))
    return list(db.scalars(select(links.interview_id)
                           .where(links.job_posting_id == posting_id,
                                  links.interview_id.not_in(shared))))


def suggested_header(db: Session, posting: JobPosting) -> HeaderIn | None:
    """The most recently used header, with the posting's role title as the headline. Phase 5
    suggests a headline from the posting instead."""
    header_id = latest_header_id(db, posting.account_id)
    if header_id is None:
        return None
    header = db.get(Header, header_id)
    values = {field: getattr(header, field) for field in HEADER_FIELDS}
    return HeaderIn(**{**values, "headline": posting.role_title})


def detail(db: Session, posting: JobPosting) -> PostingDetail:
    return PostingDetail(
        **to_out(db, [posting])[0].model_dump(),
        suggested_header=None if posting.header_id else suggested_header(db, posting),
        lone_interviews=len(lone_interviews(db, posting.job_posting_id)))


def refreshed(db: Session, posting: JobPosting) -> PostingDetail:
    db.flush()
    db.refresh(posting)
    return detail(db, posting)


@router.get("")
def list_postings(db: DbSession, account_id: AccountId) -> list[PostingOut]:
    """Most recently updated first."""
    return to_out(db, list(db.scalars(
        select(JobPosting).where(JobPosting.account_id == account_id)
        .order_by(JobPosting.updated_at.desc(), JobPosting.job_posting_id.desc()))))


@router.get("/{posting_id}")
def get_posting(posting_id: int, db: DbSession, account_id: AccountId) -> PostingDetail:
    return detail(db, get_owned(db, JobPosting, posting_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_posting(body: PostingIn, db: DbSession, account_id: AccountId) -> PostingDetail:
    """A new posting, with no header yet: the user picks one next, from the suggestion."""
    posting = JobPosting(account_id=account_id, **body.model_dump())
    db.add(posting)
    return refreshed(db, posting)


@router.put("/{posting_id}")
def update_posting(posting_id: int, body: PostingIn, db: DbSession,
                   account_id: AccountId) -> PostingDetail:
    """Replaces the url, organization, role title, and description."""
    posting = get_owned(db, JobPosting, posting_id, account_id)
    for name, value in body.model_dump().items():
        setattr(posting, name, value)
    return refreshed(db, posting)


@router.put("/{posting_id}/header")
def set_header(posting_id: int, body: HeaderIn, db: DbSession,
               account_id: AccountId) -> PostingDetail:
    """The posting's header values, each picked or typed on its own. The posting and all its
    resumes and cover letters point at the saved header with exactly these values, or a new
    one; no header is changed. Once applied to, it's locked with its versions
    (docs/FRONTEND_CHECKS.md, "Headers")."""
    posting = get_owned(db, JobPosting, posting_id, account_id)
    if posting.applied_on is not None:
        raise AppError(ErrorCode.VERSION_LOCKED)
    header = find_identical(db, account_id, body)
    if header is None:
        header = Header(account_id=account_id, **body.model_dump())
        db.add(header)
        db.flush()
    posting.header_id = header.header_id
    for model in (Resume, CoverLetter):
        db.execute(update(model).where(model.job_posting_id == posting_id)
                   .values(header_id=header.header_id))
    return refreshed(db, posting)


@router.delete("/{posting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_posting(posting_id: int, db: DbSession, account_id: AccountId) -> None:
    """Deletes its resumes and cover letters, and the interviews no other posting is linked
    to; shared interviews stay (docs/FRONTEND_CHECKS.md, "Delete warnings")."""
    posting = get_owned(db, JobPosting, posting_id, account_id)
    lone = lone_interviews(db, posting_id)
    if lone:
        db.execute(delete(Interview).where(Interview.interview_id.in_(lone)))
    db.delete(posting)
