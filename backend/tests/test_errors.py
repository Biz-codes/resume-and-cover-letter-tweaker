"""Error responses (docs/API_ERRORS.md) and one transaction per request."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import delete, insert, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db import DbSession, get_db
from app.errors import AppError, ErrorCode, code_for_db_error, register_error_handlers
from app.models import SKILLS_SECTION_ID, Account, Section


@pytest.fixture
def account_id(db: Session) -> int:
    account = Account()
    db.add(account)
    db.flush()
    return account.account_id


def db_error(db: Session, statement, params=None) -> DBAPIError:
    with pytest.raises(DBAPIError) as error, db.begin_nested():
        db.execute(statement, params)
    return error.value


# Database errors map to codes


def test_unique_violation_is_duplicate(db: Session, account_id: int):
    db.add(Section(account_id=account_id, title="Volunteer"))
    db.flush()
    error = db_error(db, insert(Section).values(account_id=account_id, title="Volunteer"))
    assert code_for_db_error(error) == ErrorCode.DUPLICATE


def test_foreign_key_violation_is_not_found(db: Session):
    error = db_error(db, insert(Section).values(account_id=999_999, title="Volunteer"))
    assert code_for_db_error(error) == ErrorCode.NOT_FOUND


def test_built_in_trigger_is_built_in_protected(db: Session):
    error = db_error(db, delete(Section).where(Section.id == SKILLS_SECTION_ID))
    assert code_for_db_error(error) == ErrorCode.BUILT_IN_PROTECTED


def test_other_database_errors_are_internal(db: Session):
    error = db_error(db, text("INSERT INTO section (title) VALUES (NULL)"))
    assert code_for_db_error(error) == ErrorCode.INTERNAL_ERROR


# Responses and transactions, through a small app using the real handlers and get_db


class SectionIn(BaseModel):
    account_id: int
    title: str


@pytest.fixture
def test_app(client: TestClient) -> TestClient:
    # `client` installs the test database session; reuse its override on a separate app.
    app = FastAPI()
    register_error_handlers(app)
    app.dependency_overrides[get_db] = client.app.dependency_overrides[get_db]

    @app.post("/sections")
    def add_section(body: SectionIn, db: DbSession):
        db.execute(insert(Section).values(account_id=body.account_id, title=body.title))
        return {"ok": True}

    @app.post("/sections-then-fail")
    def add_section_then_fail(body: SectionIn, db: DbSession):
        db.execute(insert(Section).values(account_id=body.account_id, title=body.title))
        raise AppError(ErrorCode.VALIDATION_FAILED, "Second step failed.", "title")

    @app.delete("/built-in")
    def delete_built_in(db: DbSession):
        db.execute(delete(Section).where(Section.id == SKILLS_SECTION_ID))

    @app.get("/crash")
    def crash():
        raise RuntimeError("secret details")

    return TestClient(app, raise_server_exceptions=False)


def section_titles(db: Session, account_id: int) -> list[str]:
    return list(db.scalars(select(Section.title).where(Section.account_id == account_id)))


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_write_commits(test_app: TestClient, db: Session, account_id: int):
    response = test_app.post("/sections", json={"account_id": account_id, "title": "Volunteer"})
    assert response.status_code == 200
    assert section_titles(db, account_id) == ["Volunteer"]


def test_failed_request_changes_nothing(test_app: TestClient, db: Session, account_id: int):
    response = test_app.post(
        "/sections-then-fail", json={"account_id": account_id, "title": "Volunteer"}
    )
    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "VALIDATION_FAILED", "message": "Second step failed.", "field": "title"}
    }
    assert section_titles(db, account_id) == []


def test_duplicate_response(test_app: TestClient, account_id: int):
    body = {"account_id": account_id, "title": "Volunteer"}
    test_app.post("/sections", json=body)
    response = test_app.post("/sections", json=body)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE"


def test_built_in_protected_response(test_app: TestClient):
    response = test_app.delete("/built-in")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BUILT_IN_PROTECTED"


def test_validation_response_names_the_field(test_app: TestClient):
    response = test_app.post("/sections", json={"account_id": 1})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert response.json()["error"]["field"] == "title"


def test_unknown_route_is_not_found(client: TestClient):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_unexpected_error_hides_details(test_app: TestClient):
    response = test_app.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "secret" not in response.text
