"""Claude's suggestion for a new tone from a posting (app/tone_suggestions.py;
docs/FRONTEND_CHECKS.md, "Claude's suggested tone"), and saving it, with a stand-in for Claude."""

import json
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.main import app
from app.models import (
    SUMMARY_SECTION_ID,
    Account,
    NarrativeContent,
    ResumeNarrativeContent,
    ToneRule,
    ToneSet,
)
from app.tone_suggestions import SuggestedRule, ToneReply
from tests.test_documents import place, posting
from tests.test_education_narrative_rules import rule_id, rule_texts, tone
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, error, resume


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages(reply=ToneReply(name="Warm", reason="Friendly posting.", rules=[]))
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def ask_for_tone(client: TestClient, posting_id: int, kind: str = "resume"):
    return client.post("/api/tone-sets/suggested", json={"job_posting_id": posting_id,
                                                         "kind": kind})


def saved_rule(tone_rule_id: int, text: str = "") -> SuggestedRule:
    return SuggestedRule(tone_rule_id=tone_rule_id, rule_text=text, reason="Fits.")


def new_rule(text: str) -> SuggestedRule:
    return SuggestedRule(tone_rule_id=None, rule_text=text, reason="Fits.")


def test_suggests_a_tone_reusing_saved_rules(client: TestClient, db: Session, account_id: int,
                                             claude: FakeMessages):
    job = posting(db, account_id, sent=False)
    short = rule_id(db, account_id, "Keep sentences short.")
    hidden = add(db, ToneRule(account_id=account_id, rule_text="Set aside.", hidden=True))
    other = add(db, Account())
    theirs = add(db, ToneRule(account_id=other.account_id, rule_text="Not yours."))
    tone(db, account_id, "Warm", ["Keep sentences short."])
    earlier = resume(db, account_id, "Tech base", sent=True)
    earlier.tone_set_id = tone(db, account_id, "Direct", ["Be direct."]).tone_set_id
    claude.reply = ToneReply(name="  Warm ", reason="Friendly posting.", rules=[
        saved_rule(short),
        # New text that's a saved rule is that rule.
        new_rule("keep   sentences short."),
        new_rule("Lead with  teamwork."),
        # A rule the account can't use, with its wording, is new text; without it, left out.
        saved_rule(hidden.tone_rule_id, "Set aside, but said again."),
        saved_rule(theirs.tone_rule_id),
        new_rule("  "),
    ])
    rules_before = db.scalar(select(func.count()).select_from(ToneRule))
    tones_before = db.scalar(select(func.count()).select_from(ToneSet))

    response = ask_for_tone(client, job.job_posting_id)
    assert response.status_code == 200, response.json()
    assert response.json() == {
        # "Warm" is taken, so it starts from one that can be saved.
        "name": "Warm (2)",
        "reason": "Friendly posting.",
        "rules": [
            {"tone_rule_id": short, "rule_text": "Keep sentences short.", "reason": "Fits."},
            {"tone_rule_id": None, "rule_text": "Lead with teamwork.", "reason": "Fits."},
            {"tone_rule_id": None, "rule_text": "Set aside, but said again.", "reason": "Fits."},
        ],
    }
    # Nothing is saved.
    assert db.scalar(select(func.count()).select_from(ToneRule)) == rules_before
    assert db.scalar(select(func.count()).select_from(ToneSet)) == tones_before

    [request] = claude.calls
    assert request["output_format"] is ToneReply
    assert request["output_config"] == {"effort": "medium"}
    instructions, data = request["system"]
    assert data["cache_control"] == {"type": "ephemeral"}
    assert "resume" in instructions["text"]
    rules = json.loads(data["text"].split("<rules>\n")[1].split("\n</rules>")[0])
    ids = [rule["id"] for rule in rules]
    assert short in ids and hidden.tone_rule_id not in ids and theirs.tone_rule_id not in ids
    tones = json.loads(data["text"].split("<tones>\n")[1].split("\n</tones>")[0])
    assert {"name": "Warm", "rule_ids": [short]} in tones
    content = request["messages"][0]["content"]
    assert content.startswith("Write a tone for a new resume for this posting.")
    assert "Build things." in content


def test_reads_earlier_documents_with_their_tones(client: TestClient, db: Session,
                                                  account_id: int, claude: FakeMessages):
    job = posting(db, account_id, sent=False)
    earlier = resume(db, account_id, "Tech base", sent=True)
    earlier.tone_set_id = tone(db, account_id, "Direct", ["Be direct."]).tone_set_id
    summary = add(db, NarrativeContent(account_id=account_id, content="I build apps."))
    add(db, ResumeNarrativeContent(resume_section_id=place(db, earlier, SUMMARY_SECTION_ID, 1),
                                   content_id=summary.content_id, position=1))
    resume(db, account_id, "Empty base", sent=False)

    ask_for_tone(client, job.job_posting_id, "cover_letter")
    [request] = claude.calls
    assert "cover letter" in request["system"][0]["text"]
    documents = json.loads(request["system"][1]["text"].split("<documents>\n")[1]
                           .split("\n</documents>")[0])
    # Only documents with anything in them.
    assert documents == [{"kind": "resume", "made_for": "Engineer at Acme", "tone": "Direct",
                          "text": documents[0]["text"]}]
    assert "I build apps." in documents[0]["text"]


def test_another_accounts_posting_isnt_found(client: TestClient, db: Session, account_id: int,
                                             claude: FakeMessages):
    other = add(db, Account())
    job = posting(db, other.account_id, sent=False)
    response = ask_for_tone(client, job.job_posting_id)
    assert error(response) == (404, "NOT_FOUND", None)
    assert claude.calls == []


def test_a_new_tone_saves_with_its_rules(client: TestClient, db: Session, account_id: int):
    short = rule_id(db, account_id, "Keep sentences short.")
    response = client.post("/api/tone-sets", json={"name": "Warm", "rules": [
        {"tone_rule_id": short}, {"rule_text": "Lead with teamwork."}]})
    assert response.status_code == 201, response.json()
    body = response.json()
    assert rule_texts(body) == ["Keep sentences short.", "Lead with teamwork."]
    assert body["rules"][0]["tone_rule_id"] == short
    # The new rule joined the library.
    assert db.scalar(select(ToneRule).where(ToneRule.rule_text == "Lead with teamwork.",
                                            ToneRule.account_id == account_id)) is not None
    # The same rule twice changes nothing.
    twice = client.post("/api/tone-sets", json={"name": "Twice", "rules": [
        {"tone_rule_id": short}, {"rule_text": "keep sentences short."}]})
    assert error(twice) == (409, "DUPLICATE", "rules")
    assert db.scalar(select(ToneSet).where(ToneSet.name == "Twice")) is None

