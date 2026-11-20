"""Reviewing a posting's resume and cover letter together (app/final_review.py;
docs/FRONTEND_CHECKS.md, "Reviewing a posting's resume and cover letter together"), with a
stand-in for Claude."""

from collections.abc import Iterator
from datetime import date
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import page_fit
from app.chat import ProposedChange
from app.claude import get_client
from app.final_review import Coverage, Finding, Review, ReviewFix
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    CoverLetter,
    JobPosting,
    NarrativeContent,
    ResumeBulletPoint,
    ResumeExperience,
    ResumeSection,
    WritingRule,
    WritingRuleKind,
)
from app.writing_check import Review as WritingReview
from app.writing_check import Reviewed
from tests.test_chat import DRAMA, drama, setup_resume
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, error


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages()
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def fix(document: str, action: str, target: str, section_id: int, item_id: int = 0, *,
        new_text: str = "", **parent) -> ReviewFix:
    return ReviewFix(document=document, change=ProposedChange(
        action=action, target=target, section_id=section_id, item_id=item_id,
        parent_kind=parent.get("parent_kind", ""), parent_id=parent.get("parent_id", 0),
        new_text=new_text, position=0, reason="Says it once."))


def posting_with_both(client: TestClient, db: Session, account_id: int):
    """A posting's resume (a role with two bullets in Experience) and its cover letter (one
    sentence in Summary)."""
    doc, ids = setup_resume(db, account_id)
    letter = add(db, CoverLetter(account_id=account_id, name="Letter",
                                 job_posting_id=doc.job_posting_id))
    sentence = add(db, NarrativeContent(account_id=account_id, content="I shipped it."))
    response = client.put(f"/api/cover-letters/{letter.letter_id}/tree", json={"sections": [
        {"section_id": SUMMARY_SECTION_ID, "entries": [
            {"kind": "narrative", "item_id": sentence.content_id, "skill_ids": [],
             "bullet_ids": []}]}]})
    assert response.status_code == 200, response.json()
    return doc, letter, {**ids, "sentence": sentence.content_id}


def review_url(doc) -> str:
    return f"/api/job-postings/{doc.job_posting_id}/review"


def test_reviews_both_together_and_keeps_the_review(client: TestClient, db: Session,
                                                   account_id: int, claude: FakeMessages):
    doc, letter, ids = posting_with_both(client, db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    claude.reply = Review(
        keywords=[Coverage(term=" React ", covered_by="resume", where="Experience: Shipped it"),
                  Coverage(term="Go", covered_by="neither", where="Experience")],
        findings=[
            Finding(kind="repeated", documents=["resume", "cover_letter", "resume"],
                    where="Experience:  Shipped it", why="Both say  shipped it.", fixes=[
                        fix("cover_letter", "reword", "narrative", SUMMARY_SECTION_ID,
                            ids["sentence"], new_text=" I ship weekly. "),
                        # Not in the resume, so it's left out.
                        fix("resume", "remove", "bullet", EXPERIENCE_SECTION_ID,
                            ids["Led a team"], **job)]),
            Finding(kind="keyword", documents=["resume"], where="Skills",
                    why="Nothing in the library shows Go.", fixes=[])])
    response = client.post(review_url(doc))
    assert response.status_code == 200, response.json()
    review = response.json()["final_review"]
    assert [(k["term"], k["covered_by"], k["where"]) for k in review["keywords"]] == [
        ("React", "resume", "Experience: Shipped it"), ("Go", "neither", "")]
    repeated, keyword = review["findings"]
    assert (repeated["id"], repeated["documents"], repeated["where"], repeated["why"]) == (
        "finding_1", ["resume", "cover_letter"], "Experience: Shipped it",
        "Both say shipped it.")
    [kept] = repeated["fixes"]
    assert kept["document"] == "cover_letter"
    assert (kept["proposal"]["id"], kept["proposal"]["before"], kept["proposal"]["new_text"],
            kept["proposal"]["state"]) == (
        "finding_1_fix_1", "I shipped it.", "I ship weekly.", "pending")
    assert keyword["fixes"] == []
    assert (review["checked"], review["out_of_date"]) == (True, False)

    [request] = claude.calls
    assert (request["output_format"], request["output_config"]) == (Review, {"effort": "high"})
    instructions, library = request["system"]
    assert library["cache_control"] == {"type": "ephemeral"} and "<library>" in library["text"]
    assert "the same shape and rules as a proposed change" in instructions["text"]
    content = request["messages"][0]["content"]
    for tag in ("<posting>", "<resume>", "<resume_page_fit>", "<cover_letter>",
                "<cover_letter_page_fit>"):
        assert tag in content

    # Kept with the posting, and out of date once either document changes.
    assert client.get(f"/api/job-postings/{doc.job_posting_id}").json()["final_review"] == review
    db.execute(ResumeBulletPoint.__table__.delete().where(
        ResumeBulletPoint.bullet_id == ids["Tested it"]))
    db.flush()
    again = client.get(f"/api/job-postings/{doc.job_posting_id}").json()["final_review"]
    assert again["out_of_date"] is True and again["findings"] == review["findings"]


def test_reviews_the_one_document_a_posting_has(client: TestClient, db: Session,
                                               account_id: int, claude: FakeMessages):
    doc, _ = setup_resume(db, account_id)
    claude.reply = Review(keywords=[], findings=[])
    assert client.post(review_url(doc)).status_code == 200
    content = claude.calls[0]["messages"][0]["content"]
    assert "<resume>" in content and "<cover_letter>" not in content
    # Starting the cover letter makes it out of date too.
    add(db, CoverLetter(account_id=account_id, name="Letter", job_posting_id=doc.job_posting_id))
    body = client.get(f"/api/job-postings/{doc.job_posting_id}").json()
    assert body["final_review"]["out_of_date"] is True


def test_refuses_what_it_cant_review(client: TestClient, db: Session, account_id: int,
                                     claude: FakeMessages):
    # Nothing in either.
    doc, _ = setup_resume(db, account_id)
    db.execute(ResumeBulletPoint.__table__.delete())
    db.execute(ResumeExperience.__table__.delete())
    db.execute(ResumeSection.__table__.delete())
    db.flush()
    assert error(client.post(review_url(doc)))[:2] == (422, "VALIDATION_FAILED")

    # One still in Claude's first draft.
    doc.draft = {"starting_document": None, "starting_reason": "", "texts": [], "sections": []}
    db.flush()
    assert error(client.post(review_url(doc)))[:2] == (422, "VALIDATION_FAILED")
    assert claude.calls == []


def test_a_posting_applied_to_can_be_reviewed(client: TestClient, db: Session, account_id: int,
                                              claude: FakeMessages):
    # To see what to do better next time; its fixes stay read-only (the tests below).
    sent, _ = setup_resume(db, account_id, sent=True)
    claude.reply = Review(keywords=[Coverage(term="React", covered_by="resume", where="Here")],
                          findings=[])
    response = client.post(review_url(sent))
    assert response.status_code == 200
    assert response.json()["final_review"]["keywords"][0]["term"] == "React"


def test_claude_failing_keeps_the_last_review(client: TestClient, db: Session,
                                              account_id: int, claude: FakeMessages):
    doc, _ = setup_resume(db, account_id)
    claude.reply = Review(keywords=[Coverage(term="React", covered_by="resume", where="Here")],
                          findings=[])
    assert client.post(review_url(doc)).status_code == 200
    claude.reply = anthropic.APIConnectionError(request=httpx.Request("POST", "https://x"))
    assert error(client.post(review_url(doc)))[:2] == (503, "AI_UNAVAILABLE")
    db.expire_all()
    assert db.get(JobPosting, doc.job_posting_id).final_review["keywords"][0]["term"] == "React"


def test_the_fixes_text_is_checked_against_the_writing_rules(client: TestClient, db: Session,
                                                             account_id: int,
                                                             claude: FakeMessages):
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern, rule_text=DRAMA))
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    claude.reply = Review(keywords=[], findings=[Finding(
        kind="writing", documents=["resume"], where="Experience", why="Too plain.", fixes=[
            fix("resume", "reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"],
                new_text="Shipped it — weekly.", **job)])])
    claude.replies[WritingReview] = WritingReview(texts=[
        Reviewed(key=1, issues=[drama("Drama.")], fixed_text="Shipped it weekly.")])
    review = client.post(review_url(doc)).json()["final_review"]
    proposal = review["findings"][0]["fixes"][0]["proposal"]
    assert (proposal["new_text"], proposal["fixed"], proposal["checked"]) == (
        "Shipped it weekly.", True, True)
    assert review["checked"] is True
    # The library isn't changed by a review.
    assert db.get(BulletPoint, ids["Shipped it"]).content == "Shipped it"


def fixes_of(body: dict) -> dict[str, dict]:
    """The review's fixes by id, from a posting's detail."""
    return {fix["proposal"]["id"]: fix for finding in body["final_review"]["findings"]
            for fix in finding["fixes"]}


def fix_url(doc, fix_id: str) -> str:
    return f"{review_url(doc)}/fixes/{fix_id}"


def letter_sentences(client: TestClient, letter) -> list[str]:
    body = client.get(f"/api/cover-letters/{letter.letter_id}").json()
    return [entry["values"]["content"] for section in body["sections"]
            for entry in section["entries"]]


def test_applying_a_fix_keeps_the_review_current_and_undo_takes_it_back(
        client: TestClient, db: Session, account_id: int, claude: FakeMessages):
    doc, letter, ids = posting_with_both(client, db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    sentence = ("cover_letter", "reword", "narrative", SUMMARY_SECTION_ID, ids["sentence"])
    claude.reply = Review(keywords=[], findings=[
        Finding(kind="repeated", documents=["cover_letter"], where="Summary", why="Twice.",
                fixes=[fix(*sentence, new_text="I ship weekly."),
                       fix(*sentence, new_text="I ship daily.")]),
        Finding(kind="writing", documents=["resume"], where="Experience", why="Vague.",
                fixes=[fix("resume", "remove", "bullet", EXPERIENCE_SECTION_ID,
                           ids["Tested it"], **job)])])
    client.post(review_url(doc))

    response = client.post(f"{fix_url(doc, 'finding_1_fix_1')}/apply")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["stale"] == 1
    fixes = fixes_of(body["posting"])
    applied = fixes["finding_1_fix_1"]
    assert (applied["proposal"]["state"], applied["can_undo"]) == ("applied", True)
    assert fixes["finding_1_fix_2"]["proposal"]["state"] == "stale"
    # Its own fix doesn't make the review out of date.
    assert body["posting"]["final_review"]["out_of_date"] is False
    assert letter_sentences(client, letter) == ["I ship weekly."]
    # Applied once only.
    assert error(client.post(f"{fix_url(doc, 'finding_1_fix_1')}/apply"))[:2] == (
        422, "VALIDATION_FAILED")

    # Undo puts the letter back, and the fix back to waiting; the review is still current.
    undone = client.post(f"{fix_url(doc, 'finding_1_fix_1')}/undo").json()
    assert letter_sentences(client, letter) == ["I shipped it."]
    assert fixes_of(undone)["finding_1_fix_1"]["proposal"]["state"] == "pending"
    assert fixes_of(undone)["finding_1_fix_1"]["can_undo"] is False
    assert undone["final_review"]["out_of_date"] is False

    # Once its document changes some other way, it can't be undone here, and the review is out
    # of date.
    client.post(f"{fix_url(doc, 'finding_2_fix_1')}/apply")
    db.execute(ResumeBulletPoint.__table__.delete().where(
        ResumeBulletPoint.bullet_id == ids["Shipped it"]))
    db.flush()
    shown = client.get(f"/api/job-postings/{doc.job_posting_id}").json()
    assert fixes_of(shown)["finding_2_fix_1"]["can_undo"] is False
    assert shown["final_review"]["out_of_date"] is True
    assert error(client.post(f"{fix_url(doc, 'finding_2_fix_1')}/undo"))[:2] == (
        422, "VALIDATION_FAILED")


def test_dismissing_and_restoring_a_fix(client: TestClient, db: Session, account_id: int,
                                        claude: FakeMessages):
    doc, letter, ids = posting_with_both(client, db, account_id)
    sentence = ("cover_letter", "reword", "narrative", SUMMARY_SECTION_ID, ids["sentence"])
    claude.reply = Review(keywords=[], findings=[Finding(
        kind="repeated", documents=["cover_letter"], where="Summary", why="Twice.",
        fixes=[fix(*sentence, new_text="I ship weekly."), fix(*sentence, new_text="I ship.")])])
    client.post(review_url(doc))
    dismissed = client.put(fix_url(doc, "finding_1_fix_2"), json={"state": "dismissed"}).json()
    assert fixes_of(dismissed)["finding_1_fix_2"]["proposal"]["state"] == "dismissed"
    restored = client.put(fix_url(doc, "finding_1_fix_2"), json={"state": "pending"}).json()
    assert fixes_of(restored)["finding_1_fix_2"]["proposal"]["state"] == "pending"
    # A dismissed one isn't set aside, and an applied one is undone, not dismissed.
    client.post(f"{fix_url(doc, 'finding_1_fix_1')}/apply")
    assert error(client.put(fix_url(doc, "finding_1_fix_1"), json={"state": "dismissed"}))[:2] \
        == (422, "VALIDATION_FAILED")
    # A stale one can be restored, not dismissed.
    assert error(client.put(fix_url(doc, "finding_1_fix_2"), json={"state": "dismissed"}))[:2] \
        == (422, "VALIDATION_FAILED")
    assert client.put(fix_url(doc, "finding_1_fix_2"), json={"state": "pending"}).status_code == 200
    # One that isn't in the review.
    assert error(client.post(f"{fix_url(doc, 'finding_9_fix_1')}/apply"))[:2] == (
        404, "NOT_FOUND")

    # Nothing changes once the posting is applied to.
    db.get(JobPosting, doc.job_posting_id).applied_on = date(2026, 11, 18)
    db.flush()
    assert error(client.post(f"{fix_url(doc, 'finding_1_fix_2')}/apply"))[:2] == (
        409, "VERSION_LOCKED")
    assert error(client.put(fix_url(doc, "finding_1_fix_2"), json={"state": "dismissed"}))[:2] \
        == (409, "VERSION_LOCKED")
    shown = client.get(f"/api/job-postings/{doc.job_posting_id}").json()
    assert fixes_of(shown)["finding_1_fix_1"]["can_undo"] is False


def test_a_waiting_fix_that_wouldnt_fit_is_marked(client: TestClient, db: Session,
                                                  account_id: int, claude: FakeMessages,
                                                  monkeypatch: pytest.MonkeyPatch):
    # One page of six lines; Experience takes four.
    monkeypatch.setattr(page_fit, "LINES_PER_PAGE", 6)
    monkeypatch.setattr(page_fit, "RESUME_PAGES", 1)
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    claude.reply = Review(keywords=[], findings=[Finding(
        kind="keyword", documents=["resume"], where="Experience", why="Missing.", fixes=[
            fix("resume", "add", "bullet", EXPERIENCE_SECTION_ID, new_text="Mentored. " * 30,
                **job),
            fix("resume", "add", "bullet", EXPERIENCE_SECTION_ID, ids["Led a team"], **job)])])
    fixes = fixes_of(client.post(review_url(doc)).json())
    assert fixes["finding_1_fix_1"]["proposal"]["page"] == {
        "limit": 1, "pages": 1.2, "over_lines": 1, "too_long": ["Experience"]}
    assert fixes["finding_1_fix_2"]["proposal"]["page"] is None
