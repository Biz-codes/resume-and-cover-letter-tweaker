"""Cover letters: list, read as plain text, create base letters, edit, copy, and delete.

They work like resumes (app/routers/resumes.py), plus a greeting (addressee), a sign-off, and
the name under it. A new base letter greets "Hiring Team" and signs off with the account's
"Sincerely" (docs/FRONTEND_CHECKS.md, "Default greeting" and "Default sign-off").
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
    refuse_locked_change,
)
from app.models import CoverLetter, Header, SignOff, ToneSet
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
    """A new base cover letter. Leaving out header_id, addressee, or sign_off_id starts with
    the most recently used header, "Hiring Team", and the account's "Sincerely"."""


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
    """A new base cover letter, starting with the default sections and their defaults: what the
    latest cover letter used (app/defaults.py)."""
    given = body.model_fields_set
    if "header_id" not in given:
        body.header_id = latest_header_id(db, account_id)
    if "addressee" not in given:
        body.addressee = DEFAULT_ADDRESSEE
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
    """Replaces the letter's fields. A sent letter can only be renamed."""
    letter = get_owned(db, CoverLetter, letter_id, account_id)
    refuse_locked_change(letter, doc_info(db, COVER_LETTER, [letter])[letter_id],
                         body.model_dump())
    check_links(db, body, account_id)
    for name, value in body.model_dump().items():
        setattr(letter, name, value)
    db.flush()
    db.refresh(letter)
    return detail(db, letter)


@router.post("/{letter_id}/copies", status_code=status.HTTP_201_CREATED)
def copy_letter(letter_id: int, body: CopyIn, db: DbSession,
                account_id: AccountId) -> LetterDetail:
    """A new base cover letter with the original's fields, sections, and selections. The
    original isn't changed, even when it's sent."""
    original = get_owned(db, CoverLetter, letter_id, account_id)
    copy = CoverLetter(account_id=account_id, based_on_letter_id=letter_id,
                       **{name: getattr(original, name) for name in FIELDS if name != "name"},
                       name=body.name)
    db.add(copy)
    db.flush()
    copy_tree(db, COVER_LETTER, letter_id, copy.letter_id)
    db.refresh(copy)
    return detail(db, copy)


@router.delete("/{letter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_letter(letter_id: int, db: DbSession, account_id: AccountId) -> None:
    """Removes its own selections only. Copies made from it are kept."""
    db.delete(get_owned(db, CoverLetter, letter_id, account_id))


add_tree_routes(router, COVER_LETTER, detail)
