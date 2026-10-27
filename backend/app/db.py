"""Database engine and the per-request session.

Every request gets one session, which is one transaction: it commits after the endpoint
returns and rolls back if anything raises, so a failed request changes nothing.
"""

from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True)


def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=True, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    yield from transaction(get_sessionmaker()())


def transaction(session: Session) -> Iterator[Session]:
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


# scope="function" commits before the response is sent, so a failed commit becomes an
# error response instead of a success the client already received.
DbSession = Annotated[Session, Depends(get_db, scope="function")]
