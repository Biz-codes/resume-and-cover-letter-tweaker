"""Cover letters: list, read as plain text, create them (base, or for a job posting), edit,
copy, and delete.

They work like resumes (app/routers/resumes.py), plus a greeting (addressee), a sign-off, and
the name under it. A new letter greets "[organization] Hiring Team" (just "Hiring Team" for a
base letter) and signs off with the account's "Sincerely" (docs/FRONTEND_CHECKS.md, "Default
greeting" and "Default sign-off").
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.documents import (
    COVER_LETTER,
    DocInfo,
    SectionTree,
    check_link,
    copy_tree,
    doc_info,
    latest_header_id,
    list_docs,
    load_tree,
    posting_for_version,
    posting_header_id,
    refuse_header_change,
    refuse_locked_change,
)
from app.errors import AppError, ErrorCode
from app.models import CoverLetter, Header, JobPosting, SignOff, ToneSet
from app.plain_text import Output, letter_output
from app.routers.document_tree import add_tree_routes, fill_document
from app.routers.resumes import CopyIn
from app.schemas import OptionalText, RequiredText

router = APIRouter(prefix="/api/cover-letters", tags=["cover letters"])

DEFAULT_ADDRESSEE = "Hiring Team"
DEFAULT_SIGN_OFF = "Sincerely"


class LetterIn(BaseModel):
    name: RequiredText(100)
    header_id: int | None = None
    tone_set_id: int | None = None
    addressee: OptionalText(100)
    sign_off_id: int | None = None
    signature_name: OptionalText(100)


class NewLetter(LetterIn):
    """A new cover letter: a base one, or with job_posting_id, one for that posting. Leaving out
    header_id, addressee, or sign_off_id starts with the most recently used header (a letter
    for a posting uses the posting's), "[organization] Hiring Team" (or "Hiring Team"), and the
    account's "Sincerely"."""

    job_posting_id: int | None = None


class LetterOut(LetterIn, DocInfo):
    letter_id: int


class LetterDetail(LetterOut):
    sections: list[SectionTree]
    output: Output


FIELDS = list(LetterIn.model_fields)


def to_out(db: Session, letters: list[CoverLetter]) -> list[LetterOut]:
    info = doc_info(db, COVER_LETTER, letters)
    return [LetterOut(letter_id=letter.letter_id,
                      **{name: getattr(letter, name) for name in FIELDS},
                      **info[letter.letter_id].model_dump())
            for letter in letters]


def detail(db: Session, letter: CoverLetter) -> LetterDetail:
    header = db.get(Header, letter.header_id) if letter.header_id else None
    sign_off = db.get(SignOff, letter.sign_off_id) if letter.sign_off_id else None
    sections = load_tree(db, COVER_LETTER, letter.letter_id)
    output = letter_output(header, sections, letter.addressee,
                           sign_off.text if sign_off else None, letter.signature_name)
    return LetterDetail(**to_out(db, [letter])[0].model_dump(), sections=sections,
                        output=output)


def check_links(db: Session, body: LetterIn, account_id: int) -> None:
    check_link(db, Header, Header.header_id, body.header_id, account_id, "header_id")
    check_link(db, ToneSet, ToneSet.tone_set_id, body.tone_set_id, account_id, "tone_set_id")
    check_link(db, SignOff, SignOff.sign_off_id, body.sign_off_id, account_id, "sign_off_id")


def default_addressee(posting: JobPosting | None) -> str:
    return f"{posting.organization} {DEFAULT_ADDRESSEE}" if posting else DEFAULT_ADDRESSEE


def default_sign_off_id(db: Session, account_id: int) -> int | None:
    return db.scalar(select(SignOff.sign_off_id)
                     .where(SignOff.account_id == account_id,
                            func.lower(SignOff.text) == DEFAULT_SIGN_OFF.lower())
                     .order_by(SignOff.sign_off_id).limit(1))


@router.get("")
def list_letters(db: DbSession, account_id: AccountId) -> list[LetterOut]:
    """Most recently updated first."""
    return to_out(db, list_docs(db, COVER_LETTER, account_id))


@router.get("/{letter_id}")
def get_letter(letter_id: int, db: DbSession, account_id: AccountId) -> LetterDetail:
    return detail(db, get_owned(db, CoverLetter, letter_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_letter(body: NewLetter, db: DbSession, account_id: AccountId) -> LetterDetail:
    """A new cover letter, starting with the default sections and their defaults: what the
    latest cover letter used (app/defaults.py). One for a posting uses the posting's header, so
    the posting needs one."""
    given = body.model_fields_set
    posting = None
    if body.job_posting_id is not None:
        posting = posting_for_version(db, account_id, body.job_posting_id, COVER_LETTER)
        body.header_id = posting_header_id(posting, body.header_id)
    elif "header_id" not in given:
        body.header_id = latest_header_id(db, account_id)
    if "addressee" not in given:
        body.addressee = default_addressee(posting)
    if "sign_off_id" not in given:
        body.sign_off_id = default_sign_off_id(db, account_id)
    check_links(db, body, account_id)
    letter = CoverLetter(account_id=account_id, **body.model_dump())
    db.add(letter)
    db.flush()
    fill_document(db, COVER_LETTER, letter.letter_id, account_id)
    db.refresh(letter)
    return detail(db, letter)


@router.put("/{letter_id}")
def update_letter(letter_id: int, body: LetterIn, db: DbSession,
                  account_id: AccountId) -> LetterDetail:
    """Replaces the letter's fields. A sent letter can only be renamed, and one for a posting
    keeps the posting's header."""
    letter = get_owned(db, CoverLetter, letter_id, account_id)
    refuse_locked_change(letter, doc_info(db, COVER_LETTER, [letter])[letter_id],
                         body.model_dump())
    refuse_header_change(letter, body.header_id)
    check_links(db, body, account_id)
    for name, value in body.model_dump().items():
        setattr(letter, name, value)
    db.flush()
    db.refresh(letter)
    return detail(db, letter)


@router.post("/{letter_id}/copies", status_code=status.HTTP_201_CREATED)
def copy_letter(letter_id: int, body: CopyIn, db: DbSession,
                account_id: AccountId) -> LetterDetail:
    """A new cover letter with the original's fields, sections, and selections. A copy for a
    posting uses the posting's header and greets its organization's
    hiring team. The original isn't changed, even when it's sent."""
    original = get_owned(db, CoverLetter, letter_id, account_id)
    fields = {name: getattr(original, name) for name in FIELDS if name != "name"}
    if body.job_posting_id is not None:
        posting = posting_for_version(db, account_id, body.job_posting_id, COVER_LETTER)
        fields["header_id"] = posting_header_id(posting)
        fields["addressee"] = default_addressee(posting)
    copy = CoverLetter(account_id=account_id, based_on_letter_id=letter_id,
                       job_posting_id=body.job_posting_id, **fields, name=body.name)
    db.add(copy)
    db.flush()
    copy_tree(db, COVER_LETTER, letter_id, copy.letter_id)
    db.refresh(copy)
    return detail(db, copy)


class WrittenSignOff(BaseModel):
    text: RequiredText(100)


@router.post("/{letter_id}/sign-off/written", status_code=status.HTTP_201_CREATED)
def write_sign_off(letter_id: int, body: WrittenSignOff, db: DbSession,
                   account_id: AccountId) -> LetterDetail:
    """A new sign-off, saved to the library and used by this letter. One with the same text
    (ignoring capitals) is reused instead. A sent letter can't change (VERSION_LOCKED)."""
    letter = get_owned(db, CoverLetter, letter_id, account_id)
    if doc_info(db, COVER_LETTER, [letter])[letter_id].locked:
        raise AppError(ErrorCode.VERSION_LOCKED)
    sign_off = db.scalar(select(SignOff).where(SignOff.account_id == account_id,
                                                func.lower(SignOff.text) == body.text.lower())
                         .order_by(SignOff.sign_off_id).limit(1))
    if sign_off is None:
        sign_off = SignOff(account_id=account_id, text=body.text)
        db.add(sign_off)
        db.flush()
    letter.sign_off_id = sign_off.sign_off_id
    db.flush()
    db.refresh(letter)
    return detail(db, letter)


@router.delete("/{letter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_letter(letter_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes its own selections only. Copies made from it are kept."""
    db.delete(get_owned(db, CoverLetter, letter_id, account_id))


add_tree_routes(router, COVER_LETTER, detail)
