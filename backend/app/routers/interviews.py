"""A posting's interviews. One interview can cover several postings (docs/DATABASE.md,
"job_posting_interview"), so it's reached through any posting it's linked to and always stays
linked to that one. Each can be changed at any time, including after the posting is applied to
(docs/FRONTEND_CHECKS.md, "Tracking an application").
"""

from datetime import date

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.library import check_ids
from app.models import Interview, JobPosting, JobPostingInterview
from app.routers.job_postings import PostingDetail, refreshed
from app.schemas import OptionalText

router = APIRouter(prefix="/api/job-postings/{posting_id}/interviews", tags=["interviews"])


class InterviewIn(BaseModel):
    interview_on: date
    notes: OptionalText()
    # The other postings it covered.
    also_posting_ids: list[int] = []


def get_linked(db: Session, posting_id: int, interview_id: int, account_id: int) -> Interview:
    """The posting's own interview, or NOT_FOUND."""
    get_owned(db, JobPosting, posting_id, account_id)
    interview = get_owned(db, Interview, interview_id, account_id)
    if db.get(JobPostingInterview, (posting_id, interview_id)) is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return interview


def set_links(db: Session, interview: Interview, posting_id: int, also: list[int],
              account_id: int) -> None:
    check_ids(db, JobPosting, JobPosting.job_posting_id, also, account_id, "also_posting_ids")
    if posting_id in also:
        raise AppError(ErrorCode.DUPLICATE, "The same item is in the list twice.",
                       field="also_posting_ids")
    db.execute(delete(JobPostingInterview)
               .where(JobPostingInterview.interview_id == interview.interview_id))
    db.add_all(JobPostingInterview(job_posting_id=linked, interview_id=interview.interview_id)
               for linked in [posting_id, *also])


@router.post("", status_code=status.HTTP_201_CREATED)
def add_interview(posting_id: int, body: InterviewIn, db: DbSession,
                  account_id: AccountId) -> PostingDetail:
    posting = get_owned(db, JobPosting, posting_id, account_id)
    interview = Interview(account_id=account_id, interview_on=body.interview_on, notes=body.notes)
    db.add(interview)
    db.flush()
    set_links(db, interview, posting_id, body.also_posting_ids, account_id)
    return refreshed(db, posting)


@router.put("/{interview_id}")
def update_interview(posting_id: int, interview_id: int, body: InterviewIn, db: DbSession,
                     account_id: AccountId) -> PostingDetail:
    interview = get_linked(db, posting_id, interview_id, account_id)
    interview.interview_on = body.interview_on
    interview.notes = body.notes
    set_links(db, interview, posting_id, body.also_posting_ids, account_id)
    return refreshed(db, get_owned(db, JobPosting, posting_id, account_id))


@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(posting_id: int, interview_id: int, db: DbSession,
                     account_id: AccountId) -> None:
    """Removes it from every posting it's linked to (docs/FRONTEND_CHECKS.md, "Delete
    warnings")."""
    db.delete(get_linked(db, posting_id, interview_id, account_id))
