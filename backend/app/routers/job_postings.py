"""Job postings: read one from its url or pasted text, then list, create, edit, pick the
header, track the application, and delete.

Everything for an application hangs off its posting (docs/APP_FLOW.md, "User flow"): its
header, which all its resumes and cover letters use, and those versions themselves,
which are started from app/routers/resumes.py and cover_letters.py with a job_posting_id.
Reading a posting (app/posting_reader.py) only fills the form: the user corrects it and saves
it with create. Its interviews are added and changed in app/routers/interviews.py.
"""

import re
from datetime import date, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.claude import Claude
from app.db import DbSession
from app.documents import PostingRef, latest_header_id
from app.errors import AppError, ErrorCode
from app.models import CoverLetter, Header, Interview, JobPosting, JobPostingInterview, Resume
from app.posting_reader import PostingDraft, read_posting
from app.routers.headers import FIELDS as HEADER_FIELDS
from app.routers.headers import HeaderIn, find_or_add
from app.schemas import OptionalText, RequiredText
from app.usage import Use

router = APIRouter(prefix="/api/job-postings", tags=["job postings"])


class PostingIn(BaseModel):
    url: RequiredText()
    organization: RequiredText(100)
    role_title: RequiredText(100)
    description: RequiredText()


class ReadIn(BaseModel):
    # A link to the posting, or how to reach its primary contact.
    url: OptionalText()
    # The description, pasted in when the page can't be read.
    text: OptionalText()


class TrackingIn(BaseModel):
    applied_on: date | None = None
    rejected_on: date | None = None
    hired_on: date | None = None
    contacts: OptionalText()


class InterviewOut(BaseModel):
    interview_id: int
    interview_on: date
    notes: str | None
    # The other postings it covered.
    also_for: list[PostingRef]


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
    rejected_on: date | None
    hired_on: date | None
    contacts: str | None
    # In date order.
    interviews: list[InterviewOut]
    # The organization's other postings, which an interview can also cover.
    same_organization: list[PostingRef]
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


def posting_ref(posting: JobPosting) -> PostingRef:
    return PostingRef(job_posting_id=posting.job_posting_id, organization=posting.organization,
                      role_title=posting.role_title)


def interviews(db: Session, posting_id: int) -> list[InterviewOut]:
    links = JobPostingInterview
    rows = db.scalars(select(Interview).join(links, links.interview_id == Interview.interview_id)
                      .where(links.job_posting_id == posting_id)
                      .order_by(Interview.interview_on, Interview.interview_id)).all()
    also: dict[int, list[PostingRef]] = {row.interview_id: [] for row in rows}
    for interview_id, posting in db.execute(
            select(links.interview_id, JobPosting)
            .join(JobPosting, JobPosting.job_posting_id == links.job_posting_id)
            .where(links.interview_id.in_(also), links.job_posting_id != posting_id)
            .order_by(JobPosting.job_posting_id)):
        also[interview_id].append(posting_ref(posting))
    return [InterviewOut(interview_id=row.interview_id, interview_on=row.interview_on,
                         notes=row.notes, also_for=also[row.interview_id]) for row in rows]


def same_organization(db: Session, posting: JobPosting) -> list[PostingRef]:
    return [posting_ref(other) for other in db.scalars(
        select(JobPosting)
        .where(JobPosting.account_id == posting.account_id,
               func.lower(JobPosting.organization) == posting.organization.lower(),
               JobPosting.job_posting_id != posting.job_posting_id)
        .order_by(JobPosting.job_posting_id))]


def lone_interviews(db: Session, posting_id: int) -> list[int]:
    """The interviews linked to this posting and no other."""
    links = JobPostingInterview
    shared = (select(links.interview_id).group_by(links.interview_id)
              .having(func.count() > 1))
    return list(db.scalars(select(links.interview_id)
                           .where(links.job_posting_id == posting_id,
                                  links.interview_id.not_in(shared))))


def job_title(posting: JobPosting) -> str:
    """The role title without the organization's name after it ("Full Stack Engineer at
    Cascadience" is "Full Stack Engineer"), as a headline shows it."""
    title, organization = posting.role_title.strip(), posting.organization.strip()
    if organization:
        pattern = rf"\s*(?:\bat\b|@|[-–—|,:])\s*{re.escape(organization)}\s*$"
        trimmed = re.sub(pattern, "", title, flags=re.IGNORECASE).strip()
        if trimmed:
            return trimmed
    return title


def suggested_header(db: Session, posting: JobPosting) -> HeaderIn | None:
    """The most recently used header, with the posting's job title as the headline (the title
    only, never the organization: docs/FRONTEND_CHECKS.md, "Headers")."""
    header_id = latest_header_id(db, posting.account_id)
    if header_id is None:
        return None
    header = db.get(Header, header_id)
    values = {field: getattr(header, field) for field in HEADER_FIELDS}
    return HeaderIn(**{**values, "headline": job_title(posting)})


def detail(db: Session, posting: JobPosting) -> PostingDetail:
    return PostingDetail(
        **to_out(db, [posting])[0].model_dump(),
        rejected_on=posting.rejected_on, hired_on=posting.hired_on, contacts=posting.contacts,
        interviews=interviews(db, posting.job_posting_id),
        same_organization=same_organization(db, posting),
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


@router.post("/read")
def read(body: ReadIn, client: Claude) -> PostingDraft:
    """The organization, role title, and description Claude finds in the pasted text, or else
    on the page at the url, for the user to check and correct. Saves nothing. A page that
    can't be fetched or holds no job description is POSTING_FETCH_FAILED, so the user can
    paste it in instead."""
    return read_posting(client, body.url, body.text)


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


@router.put("/{posting_id}/tracking")
def set_tracking(posting_id: int, body: TrackingIn, db: DbSession,
                 account_id: AccountId) -> PostingDetail:
    """Replaces the applied, rejected, and hired dates and the contacts, which can change at any
    time. An applied date locks the posting's versions, and clearing it unlocks them
    (docs/FRONTEND_CHECKS.md, "Sent versions are locked"). It can't be set while one of them
    has a suggestion still to review, so a sent version is never an unreviewed draft
    (docs/FRONTEND_CHECKS.md, "Claude's suggestions")."""
    posting = get_owned(db, JobPosting, posting_id, account_id)
    if posting.applied_on is None and body.applied_on is not None:
        for model, what in ((Resume, "resume"), (CoverLetter, "cover letter")):
            if db.scalar(select(model.draft.is_not(None))
                         .where(model.job_posting_id == posting_id)):
                raise AppError(ErrorCode.VALIDATION_FAILED,
                               f"Approve the first draft of the {what} first.",
                               "applied_on")
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
    header = find_or_add(db, account_id, body)[0]
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
