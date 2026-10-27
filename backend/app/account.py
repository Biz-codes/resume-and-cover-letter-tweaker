"""The current account, and looking up items within it.

Until logins exist the app has one owner account (docs/FRONTEND_CHECKS.md, "Accounts").
Every query is still scoped to the current account so more can be added later.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BACKEND_DIR
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.models import Account

# The starting writing rules and sign-off; the same file seeds them from psql.
DEFAULTS_SQL = BACKEND_DIR.parent / "db" / "seed_defaults.sql"


def create_account(db: Session) -> int:
    account = Account()
    db.add(account)
    db.flush()
    # The raw driver cursor runs the whole file as written. It adds the defaults only to
    # accounts that have none, so existing accounts are untouched.
    db.connection().connection.cursor().execute(DEFAULTS_SQL.read_text())
    return account.account_id


def current_account_id(db: DbSession) -> int:
    account_id = db.scalar(select(Account.account_id).order_by(Account.account_id).limit(1))
    return account_id if account_id is not None else create_account(db)


AccountId = Annotated[int, Depends(current_account_id)]


def get_owned[T](db: Session, model: type[T], item_id: int, account_id: int) -> T:
    """The item with this id in the account, or NOT_FOUND (also for other accounts' items)."""
    item = db.get(model, item_id)
    if item is None or item.account_id != account_id:
        raise AppError(ErrorCode.NOT_FOUND)
    return item
