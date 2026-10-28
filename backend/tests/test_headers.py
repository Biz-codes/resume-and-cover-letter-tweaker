"""The current account and the headers API (docs/FRONTEND_CHECKS.md, "Accounts" and "Headers")."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, CoverLetter, Header, JobPosting, Resume, SignOff, WritingRule

NEPTUNE = {"full_name": "Sam Rivera", "headline": "Front-End Engineer", "email": "sam@example.com"}
EMPTY = {"phone": None, "location": None, "linkedin_url": None, "github_url": None,
         "portfolio_url": None}


def add_header(db: Session, account_id: int, **values) -> int:
    header = Header(account_id=account_id, **(NEPTUNE | values))
    db.add(header)
    db.flush()
    return header.header_id


def add_posting(db: Session, account_id: int, header_id: int, applied: bool) -> int:
    posting = JobPosting(account_id=account_id, url="https://example.com/job", organization="Acme",
                         role_title="Engineer", description="Build things.", header_id=header_id,
                         applied_on=date(2026, 10, 1) if applied else None)
    db.add(posting)
    db.flush()
    return posting.job_posting_id


def add_doc(db: Session, model, account_id: int, header_id: int, posting_id: int | None):
    doc = model(account_id=account_id, name=f"{model.__name__} {posting_id}",
                header_id=header_id, job_posting_id=posting_id)
    db.add(doc)
    db.flush()
    return doc


# The current account


def test_first_request_creates_the_account_with_the_defaults(client: TestClient, db: Session):
    assert db.scalar(select(func.count()).select_from(Account)) == 0
    assert client.get("/api/headers").json() == []
    account_id = db.scalar(select(Account.account_id))
    assert db.scalar(select(func.count()).where(WritingRule.account_id == account_id)) > 0
    assert db.scalars(select(SignOff.text).where(SignOff.account_id == account_id)).all() == [
        "Sincerely"]


def test_an_existing_account_is_used_as_is(client: TestClient, db: Session, account_id: int):
    client.get("/api/headers")
    assert db.scalars(select(Account.account_id)).all() == [account_id]
    assert db.scalar(select(func.count()).select_from(WritingRule)) == 0


def test_another_accounts_header_is_not_found(client: TestClient, db: Session, account_id: int):
    other = Account()
    db.add(other)
    db.flush()
    header_id = add_header(db, other.account_id)
    for method in ("get", "put", "delete"):
        kwargs = {"json": NEPTUNE} if method == "put" else {}
        response = client.request(method, f"/api/headers/{header_id}", **kwargs)
        assert response.status_code == 404, method
        assert response.json()["error"]["code"] == "NOT_FOUND"


# Creating and reading


def test_create_list_and_get(client: TestClient, account_id: int):
    response = client.post("/api/headers", json=NEPTUNE)
    assert response.status_code == 201
    header = response.json()
    assert header == {**NEPTUNE, **EMPTY, "header_id": header["header_id"], "used_by": []}
    assert client.get("/api/headers").json() == [header]
    assert client.get(f"/api/headers/{header['header_id']}").json() == header


def test_creating_an_identical_header_returns_the_existing_one(client: TestClient,
                                                               account_id: int):
    first = client.post("/api/headers", json=NEPTUNE).json()
    again = client.post("/api/headers", json={**NEPTUNE, "phone": "  "})
    assert again.status_code == 200
    assert again.json()["header_id"] == first["header_id"]
    assert len(client.get("/api/headers").json()) == 1


def test_text_is_trimmed_and_blank_optional_fields_are_empty(client: TestClient,
                                                             account_id: int):
    header = client.post("/api/headers", json={"full_name": " Sam ", "headline": " ",
                                               "email": ""}).json()
    assert (header["full_name"], header["headline"], header["email"]) == ("Sam", None, None)


@pytest.mark.parametrize(("body", "field"), [
    ({"full_name": "   "}, "full_name"),
    ({}, "full_name"),
    ({"full_name": "Sam", "headline": "x" * 101}, "headline"),
    ({"full_name": "Sam", "phone": "1" * 51}, "phone"),
])
def test_invalid_input_names_the_field(client: TestClient, account_id: int, body, field):
    response = client.post("/api/headers", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert response.json()["error"]["field"] == field


def test_used_by_lists_postings_resumes_and_letters(client: TestClient, db: Session,
                                                    account_id: int):
    header_id = add_header(db, account_id)
    sent = add_posting(db, account_id, header_id, applied=True)
    resume = add_doc(db, Resume, account_id, header_id, sent)
    letter = add_doc(db, CoverLetter, account_id, header_id, None)
    used_by = client.get(f"/api/headers/{header_id}").json()["used_by"]
    assert used_by == [
        {"kind": "job_posting", "id": sent, "name": "Acme: Engineer", "locked": True},
        {"kind": "resume", "id": resume.resume_id, "name": resume.name, "locked": True},
        {"kind": "cover_letter", "id": letter.letter_id, "name": letter.name, "locked": False},
    ]


def test_missing_header_is_not_found(client: TestClient, account_id: int):
    assert client.get("/api/headers/999999").status_code == 404


# Editing


def test_edit_in_place_when_no_sent_version_uses_it(client: TestClient, db: Session,
                                                    account_id: int):
    header_id = add_header(db, account_id)
    posting = add_posting(db, account_id, header_id, applied=False)
    add_doc(db, Resume, account_id, header_id, posting)
    response = client.put(f"/api/headers/{header_id}", json={**NEPTUNE, "phone": "555-0100"})
    assert response.status_code == 200
    assert response.json()["header_id"] == header_id
    assert response.json()["phone"] == "555-0100"
    assert db.scalar(select(func.count()).select_from(Header)) == 1


def test_edit_saves_a_new_header_when_a_sent_version_uses_it(client: TestClient, db: Session,
                                                             account_id: int):
    header_id = add_header(db, account_id)
    applied = add_posting(db, account_id, header_id, applied=True)
    open_posting = add_posting(db, account_id, header_id, applied=False)
    users = [add_doc(db, Resume, account_id, header_id, applied),
             add_doc(db, CoverLetter, account_id, header_id, applied),
             add_doc(db, Resume, account_id, header_id, open_posting),
             add_doc(db, CoverLetter, account_id, header_id, None)]

    response = client.put(f"/api/headers/{header_id}", json={**NEPTUNE, "phone": "555-0100"})
    new_header = response.json()
    assert new_header["header_id"] != header_id
    assert new_header["phone"] == "555-0100"
    assert new_header["used_by"] == []
    db.expire_all()
    assert db.get(Header, header_id).phone is None  # the sent record is unchanged
    # Nothing switches on its own: applications in progress may need different headers.
    assert [doc.header_id for doc in users] == [header_id] * 4
    assert [db.get(JobPosting, posting).header_id for posting in (applied, open_posting)
            ] == [header_id] * 2


def test_edit_reuses_an_identical_header_instead_of_adding_one(client: TestClient, db: Session,
                                                               account_id: int):
    header_id = add_header(db, account_id)
    other_id = add_header(db, account_id, phone="555-0100")
    add_doc(db, Resume, account_id, header_id, add_posting(db, account_id, header_id, True))
    response = client.put(f"/api/headers/{header_id}", json={**NEPTUNE, "phone": "555-0100"})
    assert response.json()["header_id"] == other_id
    assert db.scalar(select(func.count()).select_from(Header)) == 2


def test_saving_unchanged_values_changes_nothing(client: TestClient, db: Session,
                                                 account_id: int):
    header_id = add_header(db, account_id)
    add_doc(db, Resume, account_id, header_id, add_posting(db, account_id, header_id, True))
    assert client.put(f"/api/headers/{header_id}", json=NEPTUNE).json()["header_id"] == header_id
    assert db.scalar(select(func.count()).select_from(Header)) == 1


# Deleting


def test_delete_keeps_what_used_it_with_no_header(client: TestClient, db: Session,
                                                  account_id: int):
    header_id = add_header(db, account_id)
    posting = add_posting(db, account_id, header_id, applied=False)
    resume = add_doc(db, Resume, account_id, header_id, posting)
    assert client.delete(f"/api/headers/{header_id}").status_code == 204
    db.expire_all()
    assert db.get(Header, header_id) is None
    assert resume.header_id is None
    assert db.get(JobPosting, posting).header_id is None
