"""Claude's suggestion for a posting's resume or cover letter (app/suggestions.py;
docs/FRONTEND_CHECKS.md, "Claude's suggestions"), with a stand-in for Claude."""

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
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    NarrativeContent,
    Resume,
    Section,
    SectionNarrativeContent,
    ToneRule,
    ToneSet,
    WritingRule,
    WritingRuleKind,
)
from app.suggestions import SuggestedBullet, SuggestedEntry, SuggestedSection, Suggestion
from tests.test_education_narrative_rules import letter
from tests.test_experience_projects_bullets import bullet, role, show_job
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, category, error, resume


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages(reply=Suggestion(starting_document_id=None, starting_reason="None.",
                                             sections=[]))
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def entry(kind: str, item_id: int | None, *, new_text: str | None = None,
          skill_ids: list[int] = (), bullets: list[SuggestedBullet] = ()) -> SuggestedEntry:
    return SuggestedEntry(kind=kind, item_id=item_id, new_text=new_text, reason="Fits.",
                          skill_ids=list(skill_ids), bullets=list(bullets))


def section(section_id: int, *entries: SuggestedEntry) -> SuggestedSection:
    return SuggestedSection(section_id=section_id, reason="Fits.", entries=list(entries))


def suggested(bullet_id: int | None, new_text: str | None = None) -> SuggestedBullet:
    return SuggestedBullet(bullet_id=bullet_id, new_text=new_text, reason="Fits.")


def suggest(client: TestClient, doc: Resume):
    return client.post(f"/api/resumes/{doc.resume_id}/suggestion")


def test_suggests_from_the_library_and_stores_the_draft(client: TestClient, db: Session,
                                                       account_id: int, claude: FakeMessages):
    job = role(db, account_id, ["Shipped it", "Tested it"], section_id=EXPERIENCE_SECTION_ID)
    shipped, tested = (bullet(db, account_id, text).bullet_id for text in ("Shipped it",
                                                                           "Tested it"))
    front_end = category(db, account_id, "Front End", ["React", "CSS"])
    earlier = resume(db, account_id, "Tech base", sent=True)
    show_job(db, earlier, job, ["Shipped it"])
    draft = resume(db, account_id, "Engineer at Acme", sent=False)
    reply = Suggestion(starting_document_id=earlier.resume_id, starting_reason="Same role.",
                       sections=[section(EXPERIENCE_SECTION_ID, entry(
                           "experience", job.experience_id,
                           bullets=[suggested(tested, "Tested it in React."), suggested(shipped)])),
                                 section(SKILLS_SECTION_ID, entry("category",
                                                                  front_end.category_id))])
    claude.reply = reply

    response = suggest(client, draft)
    assert response.status_code == 200
    assert response.json() == reply.model_dump()
    db.expire_all()
    assert db.get(Resume, draft.resume_id).draft == reply.model_dump()

    [request] = claude.calls
    assert (request["model"], request["output_config"], request["max_tokens"]) == (
        "claude-opus-5-5", {"effort": "high"}, 32000)
    assert request["output_format"] is Suggestion
    instructions, data = request["system"]
    # The library and earlier resumes come before the posting and are cached.
    assert data["cache_control"] == {"type": "ephemeral"}
    library = json.loads(data["text"].split("<library>\n")[1].split("\n</library>")[0])
    assert library["roles"][0] | {"id": job.experience_id} == {
        "id": job.experience_id, "role_title": "Engineer", "organization": "Acme",
        "location": "Remote", "dates": "2020 – 2022", "bullet_ids": [shipped, tested]}
    documents = json.loads(data["text"].split("<documents>\n")[1].split("\n</documents>")[0])
    # Only the documents with content, sent or not, and never the one being tailored.
    assert [(d["id"], d["sent"], d["made_for"]) for d in documents] == [
        (earlier.resume_id, True, "Engineer at Acme")]
    assert "resume" in instructions["text"] and "Hiring" not in instructions["text"]
    assert request["messages"][0]["content"].startswith("Tailor a new resume for this posting.")
    assert "Build things." in request["messages"][0]["content"]


def test_leaves_out_what_it_cant_use(client: TestClient, db: Session, account_id: int,
                                     claude: FakeMessages):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    unlisted = add(db, BulletPoint(account_id=account_id, content="Unlisted")).bullet_id
    hidden = add(db, BulletPoint(account_id=account_id, content="Hidden", hidden=True)).bullet_id
    theirs = add(db, NarrativeContent(account_id=add(db, Account()).account_id,
                                      content="Not mine.")).content_id
    hidden_section = add(db, Section(account_id=account_id, title="Old", hidden=True)).id
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools.")).content_id
    front_end = category(db, account_id, "Front End", ["React"])
    react = front_end.category_id
    claude.reply = Suggestion(starting_document_id=999, starting_reason="?", sections=[
        section(SUMMARY_SECTION_ID,
                entry("narrative", intro, new_text=" I build tools. "),
                entry("narrative", None, new_text="I teach."),
                entry("narrative", None, new_text="  "),
                entry("narrative", theirs)),
        section(EXPERIENCE_SECTION_ID,
                entry("experience", job.experience_id, new_text="Lead Engineer",
                      bullets=[suggested(shipped), suggested(unlisted), suggested(hidden),
                               suggested(None, "Led a team.")]),
                entry("bullet", shipped),
                entry("experience", job.experience_id)),
        section(SKILLS_SECTION_ID, entry("category", react, skill_ids=[999])),
        section(hidden_section),
        section(SUMMARY_SECTION_ID),
    ])
    body = suggest(client, resume(db, account_id, "Engineer at Acme", sent=False)).json()
    assert body["starting_document_id"] is None
    assert [s["section_id"] for s in body["sections"]] == [
        SUMMARY_SECTION_ID, EXPERIENCE_SECTION_ID, SKILLS_SECTION_ID]
    summary, experience, skills = (s["entries"] for s in body["sections"])
    # The same text as the original is no rewording; empty new text and another account's
    # item are left out.
    assert [(e["item_id"], e["new_text"]) for e in summary] == [(intro, None), (None, "I teach.")]
    # A role can't be reworded, bullets it doesn't list or that are hidden are left out, and
    # a bullet or role already in the section isn't placed again.
    [placed] = experience
    assert placed["new_text"] is None
    assert [(b["bullet_id"], b["new_text"]) for b in placed["bullets"]] == [
        (shipped, None), (None, "Led a team.")]
    assert skills[0]["skill_ids"] == []


def test_refuses_a_sent_document(client: TestClient, db: Session, account_id: int,
                                 claude: FakeMessages):
    response = suggest(client, resume(db, account_id, "Sent", sent=True))
    assert error(response)[:2] == (409, "VERSION_LOCKED")
    assert claude.calls == []


def test_refuses_a_base_document_and_a_second_suggestion(client: TestClient, db: Session,
                                                         account_id: int, claude: FakeMessages):
    base = add(db, Resume(account_id=account_id, name="Tech base"))
    assert error(suggest(client, base))[:2] == (422, "VALIDATION_FAILED")
    draft = resume(db, account_id, "Engineer at Acme", sent=False)
    assert suggest(client, draft).status_code == 200
    assert error(suggest(client, draft))[:2] == (422, "VALIDATION_FAILED")
    assert len(claude.calls) == 1


def test_claude_failing_stores_nothing(client: TestClient, db: Session, account_id: int,
                                       claude: FakeMessages):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.reply = anthropic.APIConnectionError(request=request)
    draft = resume(db, account_id, "Engineer at Acme", sent=False)
    assert error(suggest(client, draft))[:2] == (503, "AI_UNAVAILABLE")
    db.expire_all()
    assert db.get(Resume, draft.resume_id).draft is None


def test_prompt_has_the_writing_rules_and_tone(client: TestClient, db: Session, account_id: int,
                                               claude: FakeMessages):
    for kind, text, active in ((WritingRuleKind.term, "leverage", True),
                               (WritingRuleKind.term, "synergy", False),
                               (WritingRuleKind.pattern, "em dashes used for drama", True)):
        add(db, WritingRule(account_id=account_id, kind=kind, rule_text=text, active=active))
    tone = add(db, ToneSet(account_id=account_id, name="Tech"))
    add(db, ToneRule(tone_set_id=tone.tone_set_id, rule_text="Name the tools.", position=1))
    draft = resume(db, account_id, "Engineer at Acme", sent=False)
    draft.tone_set_id = tone.tone_set_id
    db.flush()
    suggest(client, draft)
    [request] = claude.calls
    instructions = request["system"][0]["text"]
    assert "Never use these words or phrases: leverage." in instructions
    assert "- em dashes used for drama" in instructions
    assert "synergy" not in instructions
    assert request["messages"][0]["content"].endswith(
        "Tone for this document:\n- Name the tools.")


def test_a_cover_letter_is_tailored_as_a_letter(client: TestClient, db: Session,
                                                account_id: int, claude: FakeMessages):
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools."))
    add(db, SectionNarrativeContent(section_id=SUMMARY_SECTION_ID, content_id=intro.content_id,
                                    position=1))
    doc = letter(db, account_id, "Engineer at Acme", sent=False)
    response = client.post(f"/api/cover-letters/{doc.letter_id}/suggestion")
    assert response.status_code == 200
    [request] = claude.calls
    assert "each paragraph is its own section" in request["system"][0]["text"]
    assert request["messages"][0]["content"].startswith("Tailor a new cover letter")


def test_applying_waits_until_the_draft_is_reviewed(client: TestClient, db: Session,
                                                    account_id: int, claude: FakeMessages):
    draft = resume(db, account_id, "Engineer at Acme", sent=False)
    suggest(client, draft)
    tracking = f"/api/job-postings/{draft.job_posting_id}/tracking"
    response = client.put(tracking, json={"applied_on": "2026-11-04"})
    assert error(response) == (422, "VALIDATION_FAILED", "applied_on")
    assert "Finish reviewing Claude's suggestion for the resume" in response.json()["error"][
        "message"]
    # Other tracking still saves.
    assert client.put(tracking, json={"contacts": "Jamie Lee"}).status_code == 200
    db.expire_all()
    db.get(Resume, draft.resume_id).draft = None
    db.flush()
    final = client.put(tracking, json={"applied_on": "2026-11-04"})
    assert final.status_code == 200, final.json()
