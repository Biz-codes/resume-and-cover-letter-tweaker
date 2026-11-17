"""The writing check on the user's own text, run each time a bullet's or narrative content's text
is saved (app/own_text.py; docs/FRONTEND_CHECKS.md, "Writing rules"), with a stand-in for
Claude."""

import json
from collections.abc import Iterator
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.claude import get_client
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    NarrativeContent,
    WritingRule,
    WritingRuleKind,
)
from app.writing_check import Issue, Review, Reviewed
from tests.test_documents import place
from tests.test_experience_projects_bullets import role, show_job
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, error, resume

LEVERAGE = "leverage"
FLAG = {"kind": "term", "rule": LEVERAGE, "quote": "leveraged", "why": "Filler."}


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages(reply=Review(texts=[]))
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def filler(claude: FakeMessages, key: int = 1) -> None:
    """The check calls the text's "leveraged" filler, and offers a fix the app never uses."""
    claude.reply = Review(texts=[Reviewed(key=key, issues=[
        Issue(rule=LEVERAGE, quote="leveraged", why="Filler.")], fixed_text="Used React.")])


def rule(db: Session, account_id: int) -> None:
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term, rule_text=LEVERAGE))


def broken(claude: FakeMessages) -> None:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.reply = anthropic.APIConnectionError(request=request)


def test_a_new_bullet_is_flagged_never_changed(client: TestClient, db: Session, account_id: int,
                                              claude: FakeMessages):
    rule(db, account_id)
    filler(claude)
    response = client.post("/api/bullet-points", json={"content": "Leveraged React."})
    assert response.status_code == 201, response.json()
    body = response.json()
    assert (body["content"], body["flags"]) == ("Leveraged React.", [FLAG])
    db.expire_all()
    assert db.get(BulletPoint, body["bullet_id"]).flags == [FLAG]
    [request] = claude.calls
    sent = json.loads(request["messages"][0]["content"].split("<texts>\n")[1]
                      .split("\n</texts>")[0])
    assert sent == [{"key": 1, "text": "Leveraged React.", "written_by": "the person",
                     "found_terms": [LEVERAGE]}]


def test_text_with_nothing_to_find_is_checked_without_claude(client: TestClient, db: Session,
                                                              account_id: int,
                                                              claude: FakeMessages):
    rule(db, account_id)
    body = client.post("/api/narrative-content", json={"content": "I build apps."}).json()
    assert body["flags"] == []
    assert claude.calls == []


def test_a_save_isnt_lost_when_the_check_fails(client: TestClient, db: Session,
                                               account_id: int, claude: FakeMessages):
    rule(db, account_id)
    broken(claude)
    response = client.post("/api/bullet-points", json={"content": "Leveraged React."})
    assert response.status_code == 201, response.json()
    assert response.json()["flags"] is None

    # "Check writing rules" runs it again; failing again changes nothing.
    bullet_id = response.json()["bullet_id"]
    assert error(client.post(f"/api/bullet-points/{bullet_id}/check")) == (
        503, "AI_UNAVAILABLE", None)
    db.expire_all()
    assert db.get(BulletPoint, bullet_id).flags is None
    filler(claude)
    checked = client.post(f"/api/bullet-points/{bullet_id}/check")
    assert checked.status_code == 200, checked.json()
    assert checked.json()["flags"] == [FLAG]


def test_an_edit_is_checked_in_place_or_as_a_new_version(client: TestClient, db: Session,
                                                         account_id: int, claude: FakeMessages):
    rule(db, account_id)
    excerpt = add(db, NarrativeContent(account_id=account_id, content="I build apps.", flags=[]))
    filler(claude)
    edited = client.put(f"/api/narrative-content/{excerpt.content_id}",
                        json={"content": "I leveraged apps."}).json()
    assert (edited["content_id"], edited["flags"]) == (excerpt.content_id, [
        FLAG | {"quote": "leveraged"}])
    # Saving the same text doesn't check it again.
    calls = len(claude.calls)
    client.put(f"/api/narrative-content/{excerpt.content_id}",
               json={"content": "I leveraged apps."})
    assert len(claude.calls) == calls

    # A bullet a sent resume uses is saved as a new one, which is checked; the original keeps
    # its own flags.
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    show_job(db, resume(db, account_id, "Sent", sent=True), job, ["Shipped it"])
    original = db.query(BulletPoint).filter_by(content="Shipped it").one()
    new = client.put(f"/api/bullet-points/{original.bullet_id}",
                     json={"content": "Leveraged it."}).json()
    assert new["bullet_id"] != original.bullet_id and new["flags"] == [FLAG]
    db.expire_all()
    assert db.get(BulletPoint, original.bullet_id).flags is None


def test_text_written_in_a_document_is_checked_and_its_rows_show_flags(
        client: TestClient, db: Session, account_id: int, claude: FakeMessages):
    rule(db, account_id)
    job = role(db, account_id, [], section_id=EXPERIENCE_SECTION_ID)
    doc = resume(db, account_id, "Tech", sent=False)
    show_job(db, doc, job, [])
    tree = client.get(f"/api/resumes/{doc.resume_id}").json()
    [experience] = tree["sections"]
    [placed] = experience["entries"]
    filler(claude)
    written = client.post(
        f"/api/resumes/{doc.resume_id}/items/experience/{placed['row_id']}/written",
        json={"content": "Leveraged React."})
    assert written.status_code == 201, written.json()
    [bullet] = written.json()["sections"][0]["entries"][0]["bullets"]
    assert bullet["flags"] == [FLAG]

    # New narrative content written into a section, then the tree showing it.
    row_id = place(db, doc, SUMMARY_SECTION_ID, 2)
    added = client.post(f"/api/resumes/{doc.resume_id}/sections/{row_id}/written",
                        json={"kind": "narrative", "content": "I leveraged apps."})
    assert added.status_code == 201, added.json()
    shown = client.get(f"/api/resumes/{doc.resume_id}").json()
    entries = next(section["entries"] for section in shown["sections"]
                   if section["section_id"] == SUMMARY_SECTION_ID)
    assert [entry["flags"] for entry in entries if entry["kind"] == "narrative"][-1] == [
        FLAG | {"quote": "leveraged"}]
    # Other kinds have none.
    assert shown["sections"][0]["entries"][0]["flags"] is None
