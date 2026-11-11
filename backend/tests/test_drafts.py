"""Reviewing Claude's draft of a posting's resume or cover letter (app/drafts.py;
docs/FRONTEND_CHECKS.md, "Claude's suggestions"), with a stand-in for Claude."""

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    CoverLetter,
    ExperienceBulletPoint,
    JobPosting,
    NarrativeContent,
    Resume,
    Section,
    SectionNarrativeContent,
)
from app.suggestions import Suggestion
from tests.test_experience_projects_bullets import bullet, listed, role, show_job
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, error, resume
from tests.test_suggestions import (
    entry,
    letter_reply,
    letter_section,
    section,
    suggested,
    tailor,
)


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages()
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def started(client: TestClient, db: Session, account_id: int, claude: FakeMessages):
    """A resume started with Claude: a role with one bullet reworded and one new, and a new
    summary sentence next to a reworded one. Returns the resume, the library ids, and Claude's
    texts by their wording."""
    job = role(db, account_id, ["Shipped it", "Tested it"], section_id=EXPERIENCE_SECTION_ID)
    shipped, tested = (bullet(db, account_id, text).bullet_id for text in ("Shipped it",
                                                                           "Tested it"))
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools."))
    add(db, SectionNarrativeContent(section_id=SUMMARY_SECTION_ID, content_id=intro.content_id,
                                    position=1))
    earlier = resume(db, account_id, "Tech", sent=True)
    show_job(db, earlier, job, ["Shipped it"])
    claude.reply = Suggestion(starting_document_id=earlier.resume_id, starting_reason="Same.",
                              sections=[
        section(SUMMARY_SECTION_ID,
                entry("narrative", intro.content_id, new_text="I build React tools."),
                entry("narrative", None, new_text="I teach.")),
        section(EXPERIENCE_SECTION_ID, entry("experience", job.experience_id, bullets=[
            suggested(shipped, "Shipped it in React."), suggested(tested),
            suggested(None, "Led a team.")]))])
    doc = tailor(client, db, account_id).json()
    keys = {text["text"]: text["key"] for text in doc["draft"]["texts"]}
    ids = {"job": job.experience_id, "shipped": shipped, "tested": tested,
           "intro": intro.content_id, "earlier": earlier.resume_id}
    return doc, ids, keys


def _url(doc: dict[str, Any]) -> str:
    return (f"/api/resumes/{doc['resume_id']}" if "resume_id" in doc
            else f"/api/cover-letters/{doc['letter_id']}")


def put_draft(client: TestClient, doc: dict[str, Any], sections: list[dict[str, Any]],
              **body):
    return client.put(f"{_url(doc)}/draft", json={"sections": sections, **body})


def finish(client: TestClient, doc: dict[str, Any], keep: list[int] = ()):
    return client.post(f"{_url(doc)}/draft/finish", json={"keep": list(keep)})


def started_letter(client: TestClient, db: Session, account_id: int, claude: FakeMessages):
    """A cover letter started with Claude: a new paragraph of two sentences in a new section,
    a new sentence in Summary, and a greeting for the hiring manager. Returns the letter and
    Claude's texts by their wording."""
    claude.reply = letter_reply(
        letter_section(0, "why Acme", entry("narrative", None, new_text="Acme ships."),
                       entry("narrative", None, new_text="I ship too.")),
        letter_section(SUMMARY_SECTION_ID, "", entry("narrative", None, new_text="I teach.")),
        addressee="Jordan Rivera", reason="The posting names them.")
    doc = tailor(client, db, account_id, path="cover-letters").json()
    return doc, {text["text"]: text["key"] for text in doc["draft"]["texts"]}


def test_review_changes_only_the_draft(client: TestClient, db: Session, account_id: int,
                                       claude: FakeMessages):
    doc, ids, keys = started(client, db, account_id, claude)
    summary, experience = doc["draft"]["sections"]
    # Experience first, the new sentence taken out, and the reworded one back to its original.
    summary["entries"] = [summary["entries"][0] | {"use_original": True}]
    response = put_draft(client, doc, [experience, summary])
    assert response.status_code == 200, response.json()
    body = response.json()
    assert [s["section_id"] for s in body["draft"]["sections"]] == [
        EXPERIENCE_SECTION_ID, SUMMARY_SECTION_ID]
    assert body["draft"]["sections"][1]["entries"][0]["use_original"] is True
    # Claude's texts all stay, so the unused ones can still be kept at the end.
    assert body["draft"]["texts"] == doc["draft"]["texts"]
    assert body["sections"] == []
    db.expire_all()
    assert db.scalars(select(NarrativeContent.content)).all() == ["I build tools."]


def test_review_refuses_what_claude_couldnt_have_suggested(client: TestClient, db: Session,
                                                           account_id: int,
                                                           claude: FakeMessages):
    doc, ids, keys = started(client, db, account_id, claude)
    summary, experience = doc["draft"]["sections"]
    unlisted = add(db, BulletPoint(account_id=account_id, content="Unlisted")).bullet_id
    role_entry = experience["entries"][0]
    moved = summary["entries"][1] | {"text_key": keys["Led a team."]}
    for sections in (
        # A bullet the role doesn't list.
        [experience | {"entries": [role_entry | {"bullets": [{"bullet_id": unlisted}]}]}],
        # Claude's text somewhere else, or twice.
        [summary | {"entries": [moved]}],
        [summary | {"entries": [summary["entries"][1], summary["entries"][1]]}],
        # New text with no wording from Claude, or going back to an original it doesn't have.
        [summary | {"entries": [{"kind": "narrative", "item_id": None}]}],
        [summary | {"entries": [summary["entries"][1] | {"use_original": True}]}],
    ):
        assert error(put_draft(client, doc, sections)) == (422, "VALIDATION_FAILED", "sections")


def test_finishing_saves_what_was_kept(client: TestClient, db: Session, account_id: int,
                                       claude: FakeMessages):
    doc, ids, keys = started(client, db, account_id, claude)
    summary, experience = doc["draft"]["sections"]
    # The reworded sentence goes back to the original, and the new one is taken out; the role's
    # reworded and new bullets stay.
    summary["entries"] = [summary["entries"][0] | {"use_original": True}]
    put_draft(client, doc, [summary, experience])
    # Of the unused texts, the user keeps the new sentence for later.
    response = finish(client, doc, [keys["I teach."]])
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["draft"] is None
    assert body["based_on"] == {"id": ids["earlier"], "name": "Tech"}
    [summary_tree, experience_tree] = body["sections"]
    assert [e["values"]["content"] for e in summary_tree["entries"]] == ["I build tools."]
    [placed] = experience_tree["entries"]
    assert [b["text"] for b in placed["bullets"]] == [
        "Shipped it in React.", "Tested it", "Led a team."]

    db.expire_all()
    reworded = db.scalar(select(BulletPoint.bullet_id).where(
        BulletPoint.content == "Shipped it in React."))
    new = db.scalar(select(BulletPoint.bullet_id).where(BulletPoint.content == "Led a team."))
    # A rewording is listed right after its original, and new text under where Claude put it.
    assert listed(db, ExperienceBulletPoint, "experience_id", ids["job"], "bullet_id") == [
        ids["shipped"], reworded, ids["tested"], new]
    sentences = listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID,
                       "content_id")
    kept = db.scalar(select(NarrativeContent.content_id).where(
        NarrativeContent.content == "I teach."))
    assert sentences == [ids["intro"], kept]
    # The rewording the user went back from wasn't kept.
    assert db.scalar(select(NarrativeContent).where(
        NarrativeContent.content == "I build React tools.")) is None
    # Nothing to finish twice.
    assert error(finish(client, doc))[:2] == (422, "VALIDATION_FAILED")


def test_only_unused_text_can_be_kept_for_later(client: TestClient, db: Session,
                                               account_id: int, claude: FakeMessages):
    doc, ids, keys = started(client, db, account_id, claude)
    assert error(finish(client, doc, [keys["I teach."]])) == (422, "VALIDATION_FAILED", "keep")
    db.expire_all()
    assert db.get(Resume, doc["resume_id"]).draft is not None


def test_a_sent_document_can_not_be_reviewed(client: TestClient, db: Session,
                                             account_id: int, claude: FakeMessages):
    doc, ids, keys = started(client, db, account_id, claude)
    db.get(JobPosting, doc["job_posting"]["job_posting_id"]).applied_on = "2026-11-04"
    db.flush()
    assert error(put_draft(client, doc, []))[:2] == (409, "VERSION_LOCKED")
    assert error(finish(client, doc))[:2] == (409, "VERSION_LOCKED")


def test_built_from_scratch_starts_empty(client: TestClient, db: Session, account_id: int):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    # The defaults come from the latest resume.
    show_job(db, resume(db, account_id, "Earlier", sent=False), job, ["Shipped it"])
    body = client.post("/api/resumes", json={"name": "Blank", "empty": True}).json()
    assert (body["sections"], body["draft"]) == ([], None)
    assert client.post("/api/resumes", json={"name": "Usual"}).json()["sections"] != []


def test_finishing_a_letter_adds_its_new_sections_and_greeting(client: TestClient, db: Session,
                                                               account_id: int,
                                                               claude: FakeMessages):
    doc, keys = started_letter(client, db, account_id, claude)
    response = finish(client, doc)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["addressee"] == "Jordan Rivera"
    why, summary = body["sections"]
    assert (why["title"], summary["section_id"]) == ("why Acme", SUMMARY_SECTION_ID)
    assert [e["values"]["content"] for e in why["entries"]] == ["Acme ships.", "I ship too."]
    db.expire_all()
    new = db.scalar(select(Section).where(Section.title == "why Acme"))
    assert (new.id, new.account_id) == (why["section_id"], account_id)
    # Claude's new sentences are listed under the section Claude made for them.
    assert [db.get(NarrativeContent, content_id).content for content_id in listed(
        db, SectionNarrativeContent, "section_id", new.id, "content_id")] == [
        "Acme ships.", "I ship too."]


def test_a_letter_review_can_keep_the_usual_greeting(client: TestClient, db: Session,
                                                     account_id: int, claude: FakeMessages):
    doc, keys = started_letter(client, db, account_id, claude)
    sections = doc["draft"]["sections"]
    body = put_draft(client, doc, sections, use_default_greeting=True).json()
    assert body["draft"]["greeting"]["use_default"] is True
    # Sending the tree alone goes back to Claude's greeting.
    assert put_draft(client, doc, sections).json()["draft"]["greeting"]["use_default"] is False
    put_draft(client, doc, sections, use_default_greeting=True)
    assert finish(client, doc).json()["addressee"] == "Acme Hiring Team"


def test_a_rejected_new_section_is_not_added(client: TestClient, db: Session, account_id: int,
                                            claude: FakeMessages):
    doc, keys = started_letter(client, db, account_id, claude)
    _, summary = doc["draft"]["sections"]
    put_draft(client, doc, [summary])
    # Its sentence kept for later stands alone, since its section wasn't kept.
    response = finish(client, doc, [keys["Acme ships."]])
    assert response.status_code == 200, response.json()
    db.expire_all()
    assert db.scalar(select(Section).where(Section.title == "why Acme")) is None
    kept = db.scalar(select(NarrativeContent).where(NarrativeContent.content == "Acme ships."))
    assert kept is not None
    assert db.scalar(select(SectionNarrativeContent).where(
        SectionNarrativeContent.content_id == kept.content_id)) is None


def test_a_new_section_titled_like_a_saved_one_uses_it(client: TestClient, db: Session,
                                                       account_id: int, claude: FakeMessages):
    hidden = add(db, Section(account_id=account_id, title="Why ACME", hidden=True))
    doc, keys = started_letter(client, db, account_id, claude)
    # Hidden, so Claude wasn't shown it, but titles are unique ignoring capitals.
    assert doc["draft"]["new_sections"] == [{"key": 1, "title": "why Acme"}]
    body = finish(client, doc).json()
    assert body["sections"][0]["section_id"] == hidden.id
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Section).where(
        func.lower(Section.title) == "why acme")) == 1


def test_a_letter_review_refuses_new_sections_claude_didnt_make(client: TestClient, db: Session,
                                                               account_id: int,
                                                               claude: FakeMessages):
    doc, keys = started_letter(client, db, account_id, claude)
    why, summary = doc["draft"]["sections"]
    for sections in ([why | {"new_key": 9}], [why, why | {"entries": []}],
                     [why | {"new_key": None}]):
        assert error(put_draft(client, doc, sections)) == (422, "VALIDATION_FAILED", "sections")
    db.expire_all()
    assert db.get(CoverLetter, doc["letter_id"]).draft == doc["draft"]
