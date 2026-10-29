"""Sign-offs: the closing before the name at the end of a cover letter ("Sincerely").

A cover letter points to its sign-off (sign_off_id) and prints its text. So editing a sign-off
a sent cover letter uses saves a new sign-off; sent letters keep the original and unsent ones
switch to the new one. A sign-off no sent letter uses is edited in place
(docs/FRONTEND_CHECKS.md, "Sent versions are locked"). Deleting one leaves the letters that
used it with no closing.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.models import CoverLetter, SignOff
from app.schemas import RequiredText
from app.usage import Use, column_uses, switch_unsent_column

router = APIRouter(prefix="/api/sign-offs", tags=["sign-offs"])

USED_BY = [CoverLetter.sign_off_id]


class SignOffIn(BaseModel):
    text: RequiredText(100)


class SignOffOut(SignOffIn):
    sign_off_id: int
    used_by: list[Use]


def to_out(db: Session, sign_offs: list[SignOff]) -> list[SignOffOut]:
    used_by = column_uses(db, USED_BY, [sign_off.sign_off_id for sign_off in sign_offs])
    return [SignOffOut(sign_off_id=sign_off.sign_off_id, text=sign_off.text,
                       used_by=used_by[sign_off.sign_off_id])
            for sign_off in sign_offs]


def one_out(db: Session, sign_off: SignOff) -> SignOffOut:
    return to_out(db, [sign_off])[0]


@router.get("")
def list_sign_offs(db: DbSession, account_id: AccountId) -> list[SignOffOut]:
    """Oldest first."""
    sign_offs = db.scalars(select(SignOff).where(SignOff.account_id == account_id)
                           .order_by(SignOff.sign_off_id)).all()
    return to_out(db, list(sign_offs))


@router.get("/{sign_off_id}")
def get_one(sign_off_id: int, db: DbSession, account_id: AccountId) -> SignOffOut:
    return one_out(db, get_owned(db, SignOff, sign_off_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_sign_off(body: SignOffIn, db: DbSession, account_id: AccountId) -> SignOffOut:
    sign_off = SignOff(account_id=account_id, text=body.text)
    db.add(sign_off)
    db.flush()
    return one_out(db, sign_off)


@router.put("/{sign_off_id}")
def update_sign_off(sign_off_id: int, body: SignOffIn, db: DbSession,
                    account_id: AccountId) -> SignOffOut:
    """Edits it in place, unless a sent cover letter uses it (see the module docstring).

    The response's sign_off_id differs from the one in the url when a new one was saved.
    """
    sign_off = get_owned(db, SignOff, sign_off_id, account_id)
    if sign_off.text == body.text:
        return one_out(db, sign_off)
    used_by = column_uses(db, USED_BY, [sign_off_id])[sign_off_id]
    if not any(use.locked for use in used_by):
        sign_off.text = body.text
        db.flush()
        db.refresh(sign_off)
        return one_out(db, sign_off)

    replacement = SignOff(account_id=account_id, text=body.text)
    db.add(replacement)
    db.flush()
    switch_unsent_column(db, CoverLetter.sign_off_id, sign_off_id, replacement.sign_off_id)
    return one_out(db, replacement)


@router.delete("/{sign_off_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sign_off(sign_off_id: int, db: DbSession, account_id: AccountId) -> None:
    """Cover letters that used it keep going with no closing."""
    db.delete(get_owned(db, SignOff, sign_off_id, account_id))
