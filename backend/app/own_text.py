"""The writing check on the user's own text (docs/FRONTEND_CHECKS.md, "Writing rules"; phase 5
step 3, sub-step 4 in docs/BUILD_PLAN.md).

Each time a bullet's or narrative content's text is saved, by the user (its dialog, a new bullet
under a role or project in a document's tree, or new content added to a section), it's checked
against the account's writing rules, and what it breaks is kept with it (`flags`). The text is
never changed. A tone isn't checked, since one item can be in documents with different tones.

The save never waits on Claude being there: if the check fails, the text is saved unchecked
(`flags` None), and "Check writing rules" on the item runs it again. Claude's own wordings the
user keeps take the flags their draft or chat check found (kept_flags).

Text saved before the check existed, read from the user's own file, or saved while Claude was
unreachable stays unchecked until "Check writing rules" on a library page checks it all at once
(check_unchecked). Text used only by sent versions went out as it is, so it's never checked.
"""

import logging
from collections.abc import Callable
from typing import Any

import anthropic
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode
from app.flag_dismissal import carry_dismissed, counted
from app.models import BulletPoint, NarrativeContent
from app.usage import Link, uses
from app.writing_check import CheckText, Flag, check

logger = logging.getLogger(__name__)

Row = BulletPoint | NarrativeContent

# Texts per request when checking many at once, so each reply stays well within its limit.
BATCH = 20


class CheckedAll(BaseModel):
    # How many unchecked texts were checked, and how many of them break a writing rule.
    checked: int
    flagged: int


def check_own(db: Session, client: anthropic.Anthropic | Callable[[], anthropic.Anthropic],
              account_id: int, rows: list[Row], *, keep_unchecked: bool = True) -> None:
    """Check each row's text and keep what it breaks in its `flags` ([] for nothing). With
    `keep_unchecked`, a failed check leaves them unchecked (None) rather than failing the save;
    without it ("Check writing rules"), it's AI_UNAVAILABLE and nothing changes."""
    texts = [CheckText(key=key, text=row.content, claude=False)
             for key, row in enumerate(rows, start=1)]
    try:
        checked = check(db, client, account_id, texts, step="your text")
    except AppError as error:
        if error.code != ErrorCode.AI_UNAVAILABLE or not keep_unchecked:
            raise
        logger.warning("The writing check on the user's text failed, so it's unchecked",
                       exc_info=error)
        for row in rows:
            row.flags = None
        db.flush()
        return
    for key, row in enumerate(rows, start=1):
        result = checked.get(key)
        # Flags the user dismissed stay dismissed while the same words break the same rule.
        row.flags = carry_dismissed(row.flags,
                                    [flag.model_dump() for flag in result.flags] if result else [])
    db.flush()


def kept_flags(flags: list[Flag], checked: bool) -> list[dict[str, Any]] | None:
    """What a row saved from Claude's text keeps: the flags its check found, or None when that
    check didn't run."""
    return [flag.model_dump() for flag in flags] if checked else None


def check_unchecked(db: Session, client: anthropic.Anthropic, account_id: int,
                    model: type[Row], links: list[Link]) -> CheckedAll:
    """Every unchecked text of this kind in the account, except text used only by sent versions,
    checked in batches. It's one request to the app, so failing is AI_UNAVAILABLE and nothing
    changes."""
    rows = list(db.scalars(select(model).where(model.account_id == account_id,
                                               model.flags.is_(None))
                           .order_by(model.__mapper__.primary_key[0])))
    used_by = uses(db, links, [_id(row) for row in rows])
    rows = [row for row in rows
            if not (used_by[_id(row)] and all(use.locked for use in used_by[_id(row)]))]
    for start in range(0, len(rows), BATCH):
        check_own(db, client, account_id, rows[start:start + BATCH], keep_unchecked=False)
    return CheckedAll(checked=len(rows), flagged=sum(1 for row in rows if counted(row.flags)))


def _id(row: Row) -> int:
    return row.bullet_id if isinstance(row, BulletPoint) else row.content_id
