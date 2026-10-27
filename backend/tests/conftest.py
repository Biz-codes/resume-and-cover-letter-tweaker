"""Test setup. Tests run against TEST_DATABASE_URL, never the app database.

The schema is rebuilt from the migrations once per test run. Each test then runs inside a
transaction that's rolled back afterward, so tests can't affect each other. Commits made
by the app during a test (get_db) only release a savepoint inside that transaction.
"""

from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.orm import Session

from app.config import BACKEND_DIR, get_settings
from app.db import get_db, transaction
from app.main import app


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    # Config values are interpolated, so a literal % in the URL must be doubled.
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


@pytest.fixture(scope="session")
def test_url() -> str:
    settings = get_settings()
    if not settings.test_database_url:
        pytest.exit("Set TEST_DATABASE_URL in the backend env file to run the tests.")
    if settings.test_database_url == settings.database_url:
        pytest.exit("TEST_DATABASE_URL must point to a different database than DATABASE_URL.")
    return settings.test_database_url


@pytest.fixture(scope="session")
def engine(test_url: str) -> Iterator[Engine]:
    engine = create_engine(test_url)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    command.upgrade(alembic_config(test_url), "head")
    yield engine
    engine.dispose()


@pytest.fixture
def connection(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as connection:
        outer = connection.begin()
        yield connection
        outer.rollback()


@pytest.fixture
def db(connection: Connection) -> Iterator[Session]:
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()


@pytest.fixture
def client(connection: Connection) -> Iterator[TestClient]:
    def test_db() -> Iterator[Session]:
        yield from transaction(
            Session(
                bind=connection,
                join_transaction_mode="create_savepoint",
                expire_on_commit=False,
            )
        )

    app.dependency_overrides[get_db] = test_db
    yield TestClient(app)
    app.dependency_overrides.clear()
