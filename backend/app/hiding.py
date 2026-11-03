"""Hiding library items, and keeping a sent application's record.

See "Hiding" in docs/FRONTEND_CHECKS.md.

A hidden item is set aside: the front end leaves it out of every choice it offers and the
defaults leave it out (app/defaults.py), but whatever already shows it keeps it. Hiding changes
nothing a resume or cover letter prints, so it's set in place even when a sent version uses the
item. Deleting an item a sent version uses is refused instead, since that would change the
record of what was sent; hiding is the way to set it aside.
"""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode
from app.usage import Use


class HiddenIn(BaseModel):
    hidden: bool


def set_hidden(db: Session, item, hidden: bool) -> None:
    """Hides or unhides the item. The routers refuse the built-in sections and "Other" first."""
    if item.hidden != hidden:
        item.hidden = hidden
        db.flush()
        db.refresh(item)


def refuse_delete_if_sent(used_by: list[Use], what: str) -> None:
    """VERSION_LOCKED when a sent resume or cover letter (or applied posting) uses the item."""
    if any(use.locked for use in used_by):
        raise AppError(ErrorCode.VERSION_LOCKED,
                       f"A sent application uses this {what}, so it can't be deleted. "
                       "Hide it instead.")
