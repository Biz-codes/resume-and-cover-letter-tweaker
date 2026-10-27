"""Sent versions are locked (docs/FRONTEND_CHECKS.md, "Sent versions are locked").

A resume or cover letter is locked once its job posting has an applied_on date.
"""

from sqlalchemy import ColumnElement, and_, select

from app.models import CoverLetter, JobPosting, Resume

APPLIED_POSTINGS = select(JobPosting.job_posting_id).where(JobPosting.applied_on.is_not(None))


def is_locked(model: type[Resume] | type[CoverLetter]) -> ColumnElement[bool]:
    """A condition that's true for the model's locked rows and false (never null) otherwise."""
    return and_(model.job_posting_id.is_not(None), model.job_posting_id.in_(APPLIED_POSTINGS))
