"""Reviewing Claude's draft of a posting's resume or cover letter (app/drafts.py;
docs/FRONTEND_CHECKS.md, "Claude's suggestions"), with a stand-in for Claude."""

import json
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    CoverLetter,
    ExperienceBulletPoint,
    JobPosting,
    NarrativeContent,
    Resume,
    Section,
    SectionNarrativeContent,
    SkillCategorySkill,
    WritingRule,
    WritingRuleKind,
)
from app.suggestions import Suggestion
from app.writing_check import Issue, Review, Reviewed
from tests.test_experience_projects_bullets import bullet, listed, role, show_job
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, category, error, resume, skill_id
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


def test_finishing_lists_a_skill_under_the_category_claude_put_it_in(
        client: TestClient, db: Session, account_id: int, claude: FakeMessages):
    back = category(db, account_id, "Back End", ["Python"])
    category(db, account_id, "Tools", ["Alembic"], section_id=None)
    python, alembic = skill_id(db, "Python"), skill_id(db, "Alembic")
    claude.reply = Suggestion(starting_document_id=None, starting_reason="", sections=[
        section(SKILLS_SECTION_ID, entry("category", back.category_id,
                                         skill_ids=[alembic, python]))])
    doc = tailor(client, db, account_id).json()
    response = finish(client, doc)
    assert response.status_code == 200, response.json()
    [skills] = response.json()["sections"]
    assert [skill["text"] for skill in skills["entries"][0]["skills"]] == ["Alembic", "Python"]
    db.expire_all()
    # Listed last under Back End, where Claude put it; Python stays where it was.
    assert listed(db, SkillCategorySkill, "category_id", back.category_id, "skill_id") == [
        python, alembic]


# The writing check (app/writing_check.py) on the draft: Claude's texts are keyed 1 to 4 in
# `started` ("I build React tools.", "I teach.", "Shipped it in React.", "Led a team."), and the
# library's items after them (the summary, then "Shipped it" and "Tested it").
DRAMA = "em dashes used for drama"


def issue(why: str) -> Issue:
    return Issue(rule=DRAMA, quote="—", why=why)


def test_the_draft_is_checked_against_the_writing_rules(client: TestClient, db: Session,
                                                        account_id: int, claude: FakeMessages):
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern, rule_text=DRAMA))
    claude.replies[Review] = Review(texts=[
        Reviewed(key=2, issues=[issue("Drama.")], fixed_text="I teach classes."),
        Reviewed(key=4, issues=[issue("Drama.")], fixed_text=""),
        Reviewed(key=6, issues=[], fixed_text=""),
        Reviewed(key=7, issues=[issue("Drama too.")], fixed_text="Ignored for your own text.")])
    doc, ids, _ = started(client, db, account_id, claude)
    draft = doc["draft"]
    assert draft["checked"] is True
    # One check after the tailoring, with Claude's texts and the library's.
    check_request = claude.calls[-1]
    assert check_request["output_format"] is Review
    sent = json.loads(check_request["messages"][0]["content"].split("<texts>\n")[1]
                      .split("\n</texts>")[0])
    assert [(text["key"], text["text"], text["written_by"]) for text in sent] == [
        (1, "I build React tools.", "assistant"), (2, "I teach.", "assistant"),
        (3, "Shipped it in React.", "assistant"), (4, "Led a team.", "assistant"),
        (5, "I build tools.", "the person"), (6, "Shipped it", "the person"),
        (7, "Tested it", "the person")]
    # Claude's text is fixed where it can be, and flagged where it can't.
    texts = {text["key"]: text for text in draft["texts"]}
    assert (texts[2]["text"], texts[2]["fixed"], texts[2]["flags"]) == (
        "I teach classes.", True, [])
    assert (texts[4]["text"], texts[4]["fixed"]) == ("Led a team.", False)
    assert texts[4]["flags"] == [{"kind": "pattern", "rule": DRAMA, "quote": "—",
                                  "why": "Drama."}]
    # The library's own text is only flagged.
    assert draft["item_flags"] == [{"kind": "bullet", "item_id": ids["tested"], "flags": [
        {"kind": "pattern", "rule": DRAMA, "quote": "—", "why": "Drama too."}]}]
    assert db.get(BulletPoint, ids["tested"]).content == "Tested it"
    # The fixed wording is what approving saves.
    assert finish(client, doc).status_code == 200
    assert db.scalar(select(func.count()).select_from(NarrativeContent).where(
        NarrativeContent.content == "I teach classes.")) == 1


def test_a_failed_check_keeps_the_draft_unchecked(client: TestClient, db: Session,
                                                  account_id: int, claude: FakeMessages):
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern, rule_text=DRAMA))
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.replies[Review] = anthropic.APIConnectionError(request=request)
    doc, _, keys = started(client, db, account_id, claude)
    assert doc["draft"]["checked"] is False
    assert doc["draft"]["item_flags"] == []
    assert "I teach." in keys


def test_no_rules_means_no_check(client: TestClient, db: Session, account_id: int,
                                 claude: FakeMessages):
    doc, _, _ = started(client, db, account_id, claude)
    # Nothing to find, so Claude is asked only for the tailoring.
    assert [call.get("output_format") for call in claude.calls] == [Suggestion]
    assert doc["draft"]["checked"] is True


def test_check_again_checks_only_the_writing(client: TestClient, db: Session, account_id: int,
                                             claude: FakeMessages):
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern, rule_text=DRAMA))
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.replies[Review] = anthropic.APIConnectionError(request=request)
    doc, ids, keys = started(client, db, account_id, claude)
    # The user's review so far is kept: the summary went back to its original.
    sections = doc["draft"]["sections"]
    sections[0]["entries"][0]["use_original"] = True
    assert put_draft(client, doc, sections).status_code == 200

    # Failing again changes nothing.
    assert error(client.post(f"{_url(doc)}/draft/check"))[:2] == (503, "AI_UNAVAILABLE")
    assert client.get(_url(doc)).json()["draft"]["checked"] is False

    calls = len(claude.calls)
    claude.replies[Review] = Review(texts=[
        Reviewed(key=4, issues=[issue("Drama.")], fixed_text=""),
        Reviewed(key=5, issues=[issue("Drama too.")], fixed_text="")])
    response = client.post(f"{_url(doc)}/draft/check")
    assert response.status_code == 200
    draft = response.json()["draft"]
    # Only the writing check ran, not the tailoring.
    assert [call["output_format"] for call in claude.calls[calls:]] == [Review]
    assert draft["checked"] is True
    assert draft["sections"][0]["entries"][0]["use_original"] is True
    assert {text["key"]: len(text["flags"]) for text in draft["texts"]}[keys["Led a team."]] == 1
    assert draft["item_flags"] == [{"kind": "narrative", "item_id": ids["intro"], "flags": [
        {"kind": "pattern", "rule": DRAMA, "quote": "—", "why": "Drama too."}]}]

    # A checked draft isn't checked again.
    assert error(client.post(f"{_url(doc)}/draft/check"))[:2] == (422, "VALIDATION_FAILED")
