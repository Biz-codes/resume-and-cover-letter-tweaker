"""Resumes: list, read as plain text, create base resumes, edit, copy, and delete.

A resume with no job posting is a base resume, an ongoing starting point edited in place. A
resume for a posting that was applied to is locked: only its name can change
(docs/FRONTEND_CHECKS.md, "Versions" and "Sent versions are locked"). app/documents.py reads
and copies its sections and selections, and app/routers/document_tree.py adds the endpoints
that build them.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.documents import (
    RESUME,
    DocInfo,
    SectionTree,
    check_link,
    copy_tree,
    doc_info,
    latest_header_id,
    list_docs,
    load_tree,
    refuse_locked_change,
)
from app.models import Header, Resume, ToneSet
from app.plain_text import Output, resume_output
from app.routers.document_tree import add_tree_routes, fill_document
from app.schemas import RequiredText

router = APIRouter(prefix="/api/resumes", tags=["resumes"])


class ResumeIn(BaseModel):
    name: RequiredText(100)
    header_id: int | None = None
    tone_set_id: int | None = None


class NewResume(ResumeIn):
    """A new base resume. Leaving header_id out starts with the most recently used header."""


class CopyIn(BaseModel):
    name: RequiredText(100)


class ResumeOut(ResumeIn, DocInfo):
    resume_id: int


class ResumeDetail(ResumeOut):
    sections: list[SectionTree]
    output: Output


def to_out(db: Session, resumes: list[Resume]) -> list[ResumeOut]:
    info = doc_info(db, RESUME, resumes)
    return [ResumeOut(resume_id=resume.resume_id, name=resume.name, header_id=resume.header_id,
                      tone_set_id=resume.tone_set_id, **info[resume.resume_id].model_dump())
            for resume in resumes]


def detail(db: Session, resume: Resume) -> ResumeDetail:
    header = db.get(Header, resume.header_id) if resume.header_id else None
    sections = load_tree(db, RESUME, resume.resume_id)
    return ResumeDetail(**to_out(db, [resume])[0].model_dump(), sections=sections,
                        output=resume_output(header, sections))


def check_links(db: Session, body: ResumeIn, account_id: int) -> None:
    check_link(db, Header, Header.header_id, body.header_id, account_id, "header_id")
    check_link(db, ToneSet, ToneSet.tone_set_id, body.tone_set_id, account_id, "tone_set_id")


@router.get("")
def list_resumes(db: DbSession, account_id: AccountId) -> list[ResumeOut]:
    """Most recently updated first."""
    return to_out(db, list_docs(db, RESUME, account_id))


@router.get("/{resume_id}")
def get_resume(resume_id: int, db: DbSession, account_id: AccountId) -> ResumeDetail:
    return detail(db, get_owned(db, Resume, resume_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_resume(body: NewResume, db: DbSession, account_id: AccountId) -> ResumeDetail:
    """A new base resume, starting with the default sections and their defaults: what the
    latest resume used (app/defaults.py)."""
    if "header_id" not in body.model_fields_set:
        body.header_id = latest_header_id(db, account_id)
    check_links(db, body, account_id)
    resume = Resume(account_id=account_id, **body.model_dump())
    db.add(resume)
    db.flush()
    fill_document(db, RESUME, resume.resume_id, account_id)
    db.refresh(resume)
    return detail(db, resume)


@router.put("/{resume_id}")
def update_resume(resume_id: int, body: ResumeIn, db: DbSession,
                  account_id: AccountId) -> ResumeDetail:
    """Replaces the name, header, and tone set. A sent resume can only be renamed."""
    resume = get_owned(db, Resume, resume_id, account_id)
    refuse_locked_change(resume, doc_info(db, RESUME, [resume])[resume_id], body.model_dump())
    check_links(db, body, account_id)
    for name, value in body.model_dump().items():
        setattr(resume, name, value)
    db.flush()
    db.refresh(resume)
    return detail(db, resume)


@router.post("/{resume_id}/copies", status_code=status.HTTP_201_CREATED)
def copy_resume(resume_id: int, body: CopyIn, db: DbSession,
                account_id: AccountId) -> ResumeDetail:
    """A new base resume with the original's header, tone set, sections, and selections. The
    original isn't changed, even when it's sent."""
    original = get_owned(db, Resume, resume_id, account_id)
    copy = Resume(account_id=account_id, name=body.name, header_id=original.header_id,
                  tone_set_id=original.tone_set_id, based_on_resume_id=resume_id)
    db.add(copy)
    db.flush()
    copy_tree(db, RESUME, resume_id, copy.resume_id)
    db.refresh(copy)
    return detail(db, copy)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(resume_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes its own selections only. Copies made from it are kept."""
    db.delete(get_owned(db, Resume, resume_id, account_id))


add_tree_routes(router, RESUME, detail)
