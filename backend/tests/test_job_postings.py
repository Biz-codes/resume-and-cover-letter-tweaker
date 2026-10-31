"""Job postings by hand: the posting itself, its header, and starting its resumes and cover
letters (docs/FRONTEND_CHECKS.md, "Headers" and "Starting a version for a posting")."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    CoverLetter,
    Interview,
    JobPosting,
    JobPostingInterview,
    Resume,
    SignOff,
)
from tests.test_documents import SAM, build_resume, header, posting
from tests.test_sections_skills import add, error

NEW = {"url": "https://example.com/jobs/1", "organization": " Lincoln High ",
       "role_title": "English Teacher", "description": "Teach ninth grade English."}


def created(client: TestClient) -> dict:
    response = client.post("/api/job-postings", json=NEW)
    assert response.status_code == 201
    return response.json()


def test_create_edit_and_list_postings(client: TestClient, db: Session, account_id: int):
    new = created(client)
    assert (new["organization"], new["header_id"], new["locked"], new["versions"]) == (
        "Lincoln High", None, False, [])
    url = f"/api/job-postings/{new['job_posting_id']}"
    edited = client.put(url, json={**NEW, "role_title": "Lead English Teacher"}).json()
    assert edited["role_title"] == "Lead English Teacher"
    assert [item["job_posting_id"] for item in client.get("/api/job-postings").json()] == [
        new["job_posting_id"]]
    assert error(client.put(url, json={**NEW, "description": " "})) == (
        422, "VALIDATION_FAILED", "description")


def test_another_accounts_posting_is_not_found(client: TestClient, db: Session,
                                               account_id: int):
    other = add(db, Account())
    theirs = posting(db, other.account_id, sent=False)
    url = f"/api/job-postings/{theirs.job_posting_id}"
    assert client.get("/api/job-postings").json() == []
    assert error(client.get(url))[:2] == (404, "NOT_FOUND")
    assert error(client.delete(url))[:2] == (404, "NOT_FOUND")
    assert error(client.post("/api/resumes", json={
        "name": "Mine", "job_posting_id": theirs.job_posting_id})) == (
        404, "NOT_FOUND", "job_posting_id")


def test_the_header_is_suggested_then_picked(client: TestClient, db: Session, account_id: int):
    latest = header(db, account_id)
    add(db, Resume(account_id=account_id, name="Tech base", header_id=latest.header_id))
    new = created(client)
    # The most recently used header, with the role title as the headline.
    assert new["suggested_header"] == {**dict.fromkeys(
        ["location", "linkedin_url", "portfolio_url"]), **SAM, "headline": "English Teacher"}
    url = f"/api/job-postings/{new['job_posting_id']}/header"
    picked = client.put(url, json=new["suggested_header"]).json()
    assert picked["header_id"] not in (None, latest.header_id)
    assert picked["suggested_header"] is None
    # The same values again reuse that header.
    again = client.put(url, json=new["suggested_header"]).json()
    assert again["header_id"] == picked["header_id"]
    assert client.put(url, json=SAM).json()["header_id"] == latest.header_id


def test_start_a_resume_and_letter_for_a_posting(client: TestClient, db: Session,
                                                 account_id: int):
    add(db, SignOff(account_id=account_id, text="Sincerely"))
    new = created(client)
    posting_id = new["job_posting_id"]
    # The posting's header comes first.
    assert error(client.post("/api/resumes", json={
        "name": "Teacher (Lincoln High)", "job_posting_id": posting_id})) == (
        422, "VALIDATION_FAILED", "header_id")
    chosen = header(db, account_id, headline="English Teacher")
    client.put(f"/api/job-postings/{posting_id}/header",
               json={**SAM, "headline": "English Teacher"})
    resume = client.post("/api/resumes", json={"name": "Teacher (Lincoln High)",
                                               "job_posting_id": posting_id})
    assert resume.status_code == 201
    assert (resume.json()["header_id"], resume.json()["job_posting"]["organization"]) == (
        chosen.header_id, "Lincoln High")
    letter = client.post("/api/cover-letters", json={"name": "Teacher (Lincoln High)",
                                                     "job_posting_id": posting_id}).json()
    assert (letter["header_id"], letter["addressee"]) == (chosen.header_id,
                                                          "Lincoln High Hiring Team")
    # No other header can be picked, there or on the version itself.
    other = header(db, account_id, headline="Tutor")
    assert error(client.post("/api/resumes", json={
        "name": "Tutor", "job_posting_id": posting_id, "header_id": other.header_id})) == (
        422, "VALIDATION_FAILED", "header_id")
    resume_id = resume.json()["resume_id"]
    assert error(client.put(f"/api/resumes/{resume_id}/header", json=SAM)) == (
        422, "VALIDATION_FAILED", "header_id")
    assert error(client.put(f"/api/resumes/{resume_id}", json={
        "name": "Renamed", "header_id": other.header_id})) == (
        422, "VALIDATION_FAILED", "header_id")
    assert client.put(f"/api/resumes/{resume_id}", json={
        "name": "Teacher (Lincoln High)", "header_id": chosen.header_id}).status_code == 200
    client.post("/api/resumes", json={"name": "Tutor", "job_posting_id": posting_id})
    versions = client.get(f"/api/job-postings/{posting_id}").json()["versions"]
    assert [(use["kind"], use["name"]) for use in versions] == [
        ("resume", "Teacher (Lincoln High)"), ("resume", "Tutor"),
        ("cover_letter", "Teacher (Lincoln High)")]


def test_changing_the_posting_header_changes_its_versions(client: TestClient, db: Session,
                                                          account_id: int):
    base_header = header(db, account_id)
    base = add(db, Resume(account_id=account_id, name="Tech base",
                          header_id=base_header.header_id))
    posting_id = created(client)["job_posting_id"]
    url = f"/api/job-postings/{posting_id}/header"
    client.put(url, json={**SAM, "headline": "English Teacher"})
    resume = client.post("/api/resumes", json={"name": "Teacher",
                                               "job_posting_id": posting_id}).json()
    letter = client.post("/api/cover-letters", json={"name": "Teacher",
                                                     "job_posting_id": posting_id}).json()
    changed = client.put(url, json={**SAM, "headline": "Lead English Teacher"}).json()
    for path in (f"/api/resumes/{resume['resume_id']}",
                 f"/api/cover-letters/{letter['letter_id']}"):
        assert client.get(path).json()["header_id"] == changed["header_id"]
    # Versions for other postings, and base versions, keep theirs.
    assert client.get(f"/api/resumes/{base.resume_id}").json()["header_id"] == (
        base_header.header_id)


def test_an_applied_postings_header_is_locked(client: TestClient, db: Session,
                                              account_id: int):
    sent = posting(db, account_id, sent=True)
    assert error(client.put(f"/api/job-postings/{sent.job_posting_id}/header", json=SAM))[:2] == (
        409, "VERSION_LOCKED")


def test_copy_an_earlier_version_for_a_posting(client: TestClient, db: Session,
                                               account_id: int):
    base_header = header(db, account_id)
    base = add(db, Resume(account_id=account_id, name="Tech base",
                          header_id=base_header.header_id))
    build_resume(db, account_id, base)
    letter = add(db, CoverLetter(account_id=account_id, name="General", addressee="Ms. Lee",
                                 header_id=base_header.header_id))
    new = created(client)
    posting_id = new["job_posting_id"]
    client.put(f"/api/job-postings/{posting_id}/header",
               json={**SAM, "headline": "English Teacher"})
    posting_header = client.get(f"/api/job-postings/{posting_id}").json()["header_id"]

    copy = client.post(f"/api/resumes/{base.resume_id}/copies",
                       json={"name": "Teacher (Lincoln High)", "job_posting_id": posting_id})
    assert copy.status_code == 201
    body = copy.json()
    assert (body["job_posting"]["job_posting_id"], body["header_id"], body["based_on"]["id"]) == (
        posting_id, posting_header, base.resume_id)
    original = client.get(f"/api/resumes/{base.resume_id}").json()
    assert body["output"]["parts"][1:] == original["output"]["parts"][1:]
    # A letter copied for the posting greets its organization.
    copied = client.post(f"/api/cover-letters/{letter.letter_id}/copies",
                         json={"name": "Teacher letter", "job_posting_id": posting_id}).json()
    assert (copied["addressee"], copied["header_id"]) == ("Lincoln High Hiring Team",
                                                          posting_header)
    # A plain copy is still a new base version with the original's header.
    plain = client.post(f"/api/resumes/{base.resume_id}/copies", json={"name": "Copy"}).json()
    assert (plain["job_posting"], plain["header_id"]) == (None, base_header.header_id)


def test_an_applied_posting_gets_no_new_versions(client: TestClient, db: Session,
                                                 account_id: int):
    sent = posting(db, account_id, sent=True)
    sent.header_id = header(db, account_id).header_id
    base = add(db, Resume(account_id=account_id, name="Tech base"))
    body = {"name": "Late", "job_posting_id": sent.job_posting_id}
    assert error(client.post("/api/resumes", json=body)) == (
        409, "VERSION_LOCKED", "job_posting_id")
    assert error(client.post(f"/api/resumes/{base.resume_id}/copies", json=body))[:2] == (
        409, "VERSION_LOCKED")
    assert error(client.post("/api/cover-letters", json=body))[:2] == (409, "VERSION_LOCKED")
    assert client.get(f"/api/job-postings/{sent.job_posting_id}").json()["locked"] is True


def test_delete_a_posting_with_its_versions_and_lone_interviews(client: TestClient, db: Session,
                                                               account_id: int):
    doomed = posting(db, account_id, sent=False)
    kept = posting(db, account_id, sent=False)
    add(db, Resume(account_id=account_id, name="Doomed", job_posting_id=doomed.job_posting_id))
    lone = add(db, Interview(account_id=account_id, interview_on=date(2026, 10, 5)))
    shared = add(db, Interview(account_id=account_id, interview_on=date(2026, 10, 6)))
    for interview, postings in ((lone, [doomed]), (shared, [doomed, kept])):
        for item in postings:
            add(db, JobPostingInterview(job_posting_id=item.job_posting_id,
                                        interview_id=interview.interview_id))
    url = f"/api/job-postings/{doomed.job_posting_id}"
    assert client.get(url).json()["lone_interviews"] == 1
    assert client.delete(url).status_code == 204
    assert db.scalars(select(Resume.name)).all() == []
    assert db.scalars(select(Interview.interview_id)).all() == [shared.interview_id]
    assert db.get(JobPosting, kept.job_posting_id) is not None
