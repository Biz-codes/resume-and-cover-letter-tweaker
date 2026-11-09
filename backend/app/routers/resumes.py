"""Resumes: list, read as plain text, create them (base, or for a job posting), edit, copy, and
delete.

A resume with no job posting is a base resume, an ongoing starting point edited in place. One
for a posting uses the posting's header, starting fresh, as a copy of any earlier resume, or
tailored by Claude. Either can start from the user's own file or pasted text (app/imports.py). A
resume for a posting that was applied to is locked: only its name can change
(docs/FRONTEND_CHECKS.md, "Versions" and "Sent versions are locked"). app/documents.py reads
and copies its sections and selections, and app/routers/document_tree.py adds the endpoints
that build them.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.claude import Claude
from app.db import DbSession
from app.documents import (
    RESUME,
    DocInfo,
    SectionTree,
    check_link,
    copy_tree,
    doc_info,
    document_name,
    latest_header_id,
    list_docs,
    load_tree,
    posting_for_version,
    posting_header_id,
    refuse_header_change,
    refuse_locked_change,
    refuse_sent_delete,
)
from app.drafts import Draft, start_draft
from app.errors import AppError, ErrorCode
from app.hiding import HiddenIn, set_hidden
from app.imports import Imported, ImportIn, ReadIn, read_document, save_items
from app.models import Header, Resume, ToneSet
from app.plain_text import Output, resume_output
from app.routers.document_tree import add_tree_routes, fill_document, restore
from app.routers.headers import find_or_add
from app.schemas import RequiredText

router = APIRouter(prefix="/api/resumes", tags=["resumes"])


class ResumeIn(BaseModel):
    name: RequiredText(204)
    header_id: int | None = None
    tone_set_id: int | None = None


class NewResume(ResumeIn):
    """A new resume: a base one, or with job_posting_id, one for that posting. Leaving header_id
    out starts with the most recently used one; a resume for a posting uses the posting's."""

    job_posting_id: int | None = None
    # Starts with no sections at all ("Build from scratch"), not the defaults.
    empty: bool = False


class TailoredResume(NewResume):
    """A new resume for a posting, started by Claude. Leaving start_from_id out has Claude pick
    the earlier resume that fits best; with it, Claude starts from that one."""

    start_from_id: int | None = None


class CopyIn(BaseModel):
    """A copy: a new base version, or with job_posting_id, a version for that posting, which
    uses the posting's header."""

    name: RequiredText(204)
    job_posting_id: int | None = None


class ResumeOut(ResumeIn, DocInfo):
    resume_id: int


class ResumeDetail(ResumeOut):
    sections: list[SectionTree]
    output: Output
    # Claude's draft, until its first review is finished (app/drafts.py).
    draft: Draft | None


def to_out(db: Session, resumes: list[Resume]) -> list[ResumeOut]:
    info = doc_info(db, RESUME, resumes)
    return [ResumeOut(resume_id=resume.resume_id, name=resume.name, header_id=resume.header_id,
                      tone_set_id=resume.tone_set_id, **info[resume.resume_id].model_dump())
            for resume in resumes]


def detail(db: Session, resume: Resume) -> ResumeDetail:
    header = db.get(Header, resume.header_id) if resume.header_id else None
    sections = load_tree(db, RESUME, resume.resume_id)
    return ResumeDetail(**to_out(db, [resume])[0].model_dump(), sections=sections,
                        output=resume_output(header, sections), draft=resume.draft)


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


def new_resume(db: Session, body: NewResume, account_id: int) -> Resume:
    """A new resume, starting with the default sections and their defaults: what the latest
    resume used (app/defaults.py), or with `empty`, none. One for a posting uses the posting's
    header, so the posting needs one."""
    if body.job_posting_id is not None:
        posting = posting_for_version(db, account_id, body.job_posting_id, RESUME)
        body.header_id = posting_header_id(posting, body.header_id)
    elif "header_id" not in body.model_fields_set:
        body.header_id = latest_header_id(db, account_id)
    body.name = document_name(db, RESUME, account_id, body.name, body.job_posting_id is not None)
    check_links(db, body, account_id)
    resume = Resume(account_id=account_id, **body.model_dump(exclude={"empty"}))
    db.add(resume)
    db.flush()
    if not body.empty:
        fill_document(db, RESUME, resume.resume_id, account_id)
    return resume


@router.post("", status_code=status.HTTP_201_CREATED)
def create_resume(body: NewResume, db: DbSession, account_id: AccountId) -> ResumeDetail:
    resume = new_resume(db, body, account_id)
    db.refresh(resume)
    return detail(db, resume)


@router.post("/tailored", status_code=status.HTTP_201_CREATED)
def tailor_resume(body: TailoredResume, db: DbSession, account_id: AccountId,
                  client: Claude) -> ResumeDetail:
    """A new resume for a posting, started by Claude: it starts empty, with Claude's
    suggestion in its draft for the user to review (app/drafts.py). If Claude fails, nothing
    is created."""
    if body.job_posting_id is None:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Claude tailors a resume only for a job posting.", field="job_posting_id")
    resume = new_resume(db, NewResume.model_validate(body.model_dump(exclude={"start_from_id"},
                                                                     exclude_unset=True)
                                                     | {"empty": True}), account_id)
    start_draft(db, client, RESUME, account_id, resume, start_from=body.start_from_id)
    db.refresh(resume)
    return detail(db, resume)


@router.post("/read")
def read_resume(body: ReadIn, db: DbSession, account_id: AccountId, client: Claude) -> Imported:
    """The sections and items Claude reads in an uploaded resume (PDF or Word) or pasted text,
    each matched against the library, for the user to correct (app/imports.py). Saves
    nothing."""
    return read_document(db, client, RESUME, account_id, body)


def imported_resume(db: Session, body: ImportIn, account_id: int) -> Resume:
    """A new resume with the corrected items, each reused from the library or added to it
    (app/imports.py). A base one uses the header read from it (a saved one with the same
    values, or a new one); one for a posting uses the posting's."""
    fields = {"name": body.name, "tone_set_id": body.tone_set_id,
              "job_posting_id": body.job_posting_id, "empty": True}
    if body.job_posting_id is None and body.header is not None:
        fields["header_id"] = find_or_add(db, account_id, body.header)[0].header_id
    resume = new_resume(db, NewResume(**fields), account_id)
    restore(db, RESUME, resume.resume_id, save_items(db, account_id, body.sections), account_id)
    return resume


@router.post("/imported", status_code=status.HTTP_201_CREATED)
def import_resume(body: ImportIn, db: DbSession, account_id: AccountId) -> ResumeDetail:
    resume = imported_resume(db, body, account_id)
    db.refresh(resume)
    return detail(db, resume)


@router.post("/imported/tailored", status_code=status.HTTP_201_CREATED)
def import_and_tailor_resume(body: ImportIn, db: DbSession, account_id: AccountId,
                             client: Claude) -> ResumeDetail:
    """A posting's resume from the corrected items (as import_resume), which Claude then
    tailors to the posting from there, with its suggestion in the draft (as tailor_resume).
    If Claude fails, nothing is saved."""
    if body.job_posting_id is None:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Claude tailors a resume only for a job posting.", field="job_posting_id")
    resume = imported_resume(db, body, account_id)
    start_draft(db, client, RESUME, account_id, resume, start_from=resume.resume_id)
    db.refresh(resume)
    return detail(db, resume)


@router.put("/{resume_id}")
def update_resume(resume_id: int, body: ResumeIn, db: DbSession,
                  account_id: AccountId) -> ResumeDetail:
    """Replaces the name, header, and tone set. A sent resume can only be renamed, and one for a
    posting keeps the posting's header."""
    resume = get_owned(db, Resume, resume_id, account_id)
    refuse_locked_change(resume, doc_info(db, RESUME, [resume])[resume_id], body.model_dump())
    refuse_header_change(resume, body.header_id)
    body.name = document_name(db, RESUME, account_id, body.name, doc_id=resume_id)
    check_links(db, body, account_id)
    for name, value in body.model_dump().items():
        setattr(resume, name, value)
    db.flush()
    db.refresh(resume)
    return detail(db, resume)


@router.post("/{resume_id}/copies", status_code=status.HTTP_201_CREATED)
def copy_resume(resume_id: int, body: CopyIn, db: DbSession,
                account_id: AccountId) -> ResumeDetail:
    """A new resume with the original's tone set, sections, and selections, and its header, or
    for a posting the posting's header. The original isn't changed, even when it's sent."""
    original = get_owned(db, Resume, resume_id, account_id)
    header_id = original.header_id
    if body.job_posting_id is not None:
        posting = posting_for_version(db, account_id, body.job_posting_id, RESUME)
        header_id = posting_header_id(posting)
    name = document_name(db, RESUME, account_id, body.name, body.job_posting_id is not None)
    copy = Resume(account_id=account_id, name=name, header_id=header_id,
                  job_posting_id=body.job_posting_id, tone_set_id=original.tone_set_id,
                  based_on_resume_id=resume_id)
    db.add(copy)
    db.flush()
    copy_tree(db, RESUME, resume_id, copy.resume_id)
    db.refresh(copy)
    return detail(db, copy)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(resume_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes its own selections only. Copies made from it are kept. A sent one can't be
    deleted (VERSION_LOCKED); it can be hidden instead."""
    item = get_owned(db, Resume, resume_id, account_id)
    refuse_sent_delete(doc_info(db, RESUME, [item])[resume_id], "resume")
    db.delete(item)


@router.put("/{resume_id}/hidden")
def set_resume_hidden(resume_id: int, body: HiddenIn, db: DbSession,
                    account_id: AccountId) -> ResumeOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"), sent or not. Nothing it shows
    changes."""
    item = get_owned(db, Resume, resume_id, account_id)
    set_hidden(db, item, body.hidden)
    return to_out(db, [item])[0]


add_tree_routes(router, RESUME, detail)
