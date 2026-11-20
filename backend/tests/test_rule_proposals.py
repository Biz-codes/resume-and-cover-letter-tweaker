"""Rules in the chat (app/rule_proposals.py): Claude proposes a change to the document's tone or
the banned words, shown as a card, and applying it makes the change the way the Writing rules
page or the tone's dialog would."""

from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.main import app
from app.models import (
    PROFESSIONAL_TONE_ID,
    NarrativeContent,
    Resume,
    ToneSet,
    WritingRule,
    WritingRuleKind,
)
from app.tones import rules_of
from tests.test_chat import FakeChat, Stream, lines, send, setup_resume
from tests.test_education_narrative_rules import tone
from tests.test_sections_skills import add, error, resume


@pytest.fixture
def claude(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeChat]:
    chat = FakeChat()
    original = chat.stream

    @contextmanager
    def stream(**request: Any):
        with original(**request) as made:
            yield Stream(events=made.events, get_final_message=made.get_final_message)

    monkeypatch.setattr(chat, "stream", stream)
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=chat))
    yield chat


def rule(action: str, target: str, rule_id: int = 0, new_text: str = "") -> dict[str, Any]:
    return {"_tool": "propose_rule", "action": action, "target": target, "rule_id": rule_id,
            "new_text": new_text, "reason": "They said so."}


def proposed(client: TestClient, doc: Resume, claude: FakeChat, *tools: dict[str, Any],
             text: str = "Never say streamlined.") -> dict[str, Any]:
    """Claude's reply proposing these, as the chat returns it."""
    claude.answer("Done, and here's a rule for it.", tools=list(tools))
    return lines(send(client, doc, text))[-1]["messages"][1]


def apply(client: TestClient, doc: Resume, message: dict[str, Any], proposal_id: str = "toolu_1",
          **choice: Any):
    return client.post(f"/api/resumes/{doc.resume_id}/chat/{message['message_id']}/proposals/"
                       f"{proposal_id}/apply", json=choice or None)


def test_banning_a_word_from_the_chat(client: TestClient, db: Session, account_id: int,
                                       claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    message = proposed(client, doc, claude, rule("add", "banned", new_text="  streamlined "))
    [card] = message["proposals"]
    assert (card["kind"], card["action"], card["target"], card["new_text"], card["state"]) == (
        "rule", "add", "banned", "streamlined", "pending")
    # A rule's text isn't checked against the writing rules, and isn't on the page.
    assert "flags" not in card and "page" not in card
    response = apply(client, doc, message)
    assert response.status_code == 200
    assert response.json()["notice"] == 'Banned "streamlined".'
    assert response.json()["message"]["proposals"][0]["state"] == "applied"
    banned = db.scalars(select(WritingRule.rule_text).where(
        WritingRule.account_id == account_id, WritingRule.kind == WritingRuleKind.term)).all()
    assert banned == ["streamlined"]

    # The next message brings the rules again, with it.
    claude.answer("Noted.")
    send(client, doc, "Thanks.")
    newest = claude.calls[-1]["messages"][-1]["content"]
    assert any(block.get("text", "").startswith("<rules>\n") and "streamlined" in block["text"]
               for block in newest)


def test_unbanning_a_word_takes_its_flags_off(client: TestClient, db: Session, account_id: int,
                                              claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    banned = add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term,
                                 rule_text="spearhead"))
    flag = {"rule": "spearhead", "kind": "term", "quote": "Spearheaded", "why": "Filler."}
    flagged = add(db, NarrativeContent(account_id=account_id, content="Spearheaded it.",
                                       flags=[flag]))
    message = proposed(client, doc, claude, rule("remove", "banned", banned.writing_rule_id))
    assert message["proposals"][0]["before"] == "spearhead"
    response = apply(client, doc, message)
    assert response.json()["notice"] == 'Took "spearhead" off your banned words.'
    # Read from the database: the request deleted it in its own session.
    assert db.scalar(select(WritingRule.writing_rule_id).where(
        WritingRule.writing_rule_id == banned.writing_rule_id)) is None
    db.refresh(flagged)
    assert flagged.flags == []


def test_a_word_switched_off_is_switched_back_on(client: TestClient, db: Session,
                                                 account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    off = add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term,
                              rule_text="synergy", active=False))
    message = proposed(client, doc, claude, rule("add", "banned", new_text="Synergy"))
    assert apply(client, doc, message).status_code == 200
    db.refresh(off)
    assert off.active is True
    assert db.query(WritingRule).filter_by(account_id=account_id).count() == 1


def test_rules_that_cant_be_shown_are_left_out(client: TestClient, db: Session,
                                               account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term, rule_text="synergy"))
    message = proposed(client, doc, claude,
                       rule("add", "banned", new_text="synergy"),
                       rule("reword", "banned", 1, new_text="other"),
                       rule("remove", "banned", 99999),
                       rule("add", "tone", new_text="Name the tools."),
                       rule("add", "banned", new_text="   "))
    assert message["proposals"] == []
    # Claude hears why in its next turn.
    claude.answer("Noted.")
    send(client, doc, "Thanks.")
    results = [block["content"] for block in claude.calls[-1]["messages"][-1]["content"]
               if block["type"] == "tool_result"]
    assert results == [
        "Not shown to the person: that word or phrase is already banned.",
        "Not shown to the person: a banned word is added or removed, not reworded.",
        "Not shown to the person: there's no banned word or phrase with that id.",
        "Not shown to the person: the document has no tone.",
        "Not shown to the person: it has no new text."]


def test_a_rule_added_to_a_tone_only_this_one_uses(client: TestClient, db: Session,
                                                   account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    mine = tone(db, account_id, "Tech", ["Name the tools."])
    doc.tone_set_id = mine.tone_set_id
    db.flush()
    message = proposed(client, doc, claude, rule("add", "tone", new_text="Lead with results."))
    [card] = message["proposals"]
    assert (card["tone_set_id"], card["tone_name"], card["built_in"]) == (
        mine.tone_set_id, "Tech", False)
    response = apply(client, doc, message)
    assert response.json()["notice"] == 'Changed the "Tech" tone.'
    assert [item.rule_text for item in rules_of(db, mine.tone_set_id)] == [
        "Name the tools.", "Lead with results."]


def test_a_tone_rule_another_document_uses_asks_who_gets_it(client: TestClient, db: Session,
                                                            account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    mine = tone(db, account_id, "Tech", ["Name the tools.", "Keep it short."])
    other = resume(db, account_id, "Other", sent=False)
    doc.tone_set_id = other.tone_set_id = mine.tone_set_id
    db.flush()
    [first, second] = rules_of(db, mine.tone_set_id)
    message = proposed(client, doc, claude,
                       rule("reword", "tone", first.tone_rule_id, "Name the tools and versions."),
                       rule("remove", "tone", second.tone_rule_id))
    assert message["proposals"][0]["before"] == "Name the tools."
    # Leaving the other one out saves a new tone, so the original needs another name.
    assert error(apply(client, doc, message)) == (422, "VALIDATION_FAILED", "earlier_name")
    response = apply(client, doc, message, earlier_name="Tech (earlier)")
    assert response.status_code == 200
    assert response.json()["notice"] == (
        'Saved the change as a new "Tech" tone, which the ones you chose use now. The others '
        'keep the earlier one, now "Tech (earlier)".')
    db.refresh(doc)
    db.refresh(other)
    assert doc.tone_set_id != mine.tone_set_id and other.tone_set_id == mine.tone_set_id
    assert [item.rule_text for item in rules_of(db, doc.tone_set_id)] == [
        "Name the tools and versions.", "Keep it short."]
    db.refresh(mine)
    assert mine.name == "Tech (earlier)"
    # The document's tone changed, so the next card for it can't be applied to the old one.
    assert error(apply(client, doc, message, "toolu_2"))[:2] == (422, "VALIDATION_FAILED")


def test_choosing_every_document_changes_the_tone_in_place(client: TestClient, db: Session,
                                                          account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    mine = tone(db, account_id, "Tech", ["Name the tools."])
    other = resume(db, account_id, "Other", sent=False)
    doc.tone_set_id = other.tone_set_id = mine.tone_set_id
    db.flush()
    message = proposed(client, doc, claude, rule("add", "tone", new_text="Lead with results."))
    response = apply(client, doc, message,
                     apply_to=[{"kind": "resume", "id": other.resume_id}])
    assert response.json()["notice"] == 'Changed the "Tech" tone.'
    db.refresh(doc)
    assert doc.tone_set_id == mine.tone_set_id
    assert len(rules_of(db, mine.tone_set_id)) == 2


def test_a_built_in_tone_is_changed_as_your_own_copy(client: TestClient, db: Session,
                                                     account_id: int, claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    doc.tone_set_id = PROFESSIONAL_TONE_ID
    db.flush()
    built_in = [item.rule_text for item in rules_of(db, PROFESSIONAL_TONE_ID)]
    message = proposed(client, doc, claude, rule("add", "tone", new_text="Name the tools."))
    assert message["proposals"][0]["built_in"] is True
    # The copy needs a name, new in the account.
    assert error(apply(client, doc, message)) == (422, "VALIDATION_FAILED", "copy_name")
    assert error(apply(client, doc, message, copy_name="Professional")) == (
        409, "DUPLICATE", "copy_name")
    response = apply(client, doc, message, copy_name="Professional (mine)")
    assert response.json()["notice"] == (
        'Saved the change as your own tone, "Professional (mine)", which this one uses now.')
    db.refresh(doc)
    copy = db.get(ToneSet, doc.tone_set_id)
    assert (copy.name, copy.account_id) == ("Professional (mine)", account_id)
    assert [item.rule_text for item in rules_of(db, copy.tone_set_id)] == [
        *built_in, "Name the tools."]
    assert [item.rule_text for item in rules_of(db, PROFESSIONAL_TONE_ID)] == built_in
    assert response.json()["document"]["tone_set_id"] == copy.tone_set_id


def test_a_later_card_for_the_same_rule_sets_earlier_ones_aside(client: TestClient, db: Session,
                                                               account_id: int,
                                                               claude: FakeChat):
    doc, _ = setup_resume(db, account_id)
    mine = tone(db, account_id, "Tech", ["Name the tools."])
    doc.tone_set_id = mine.tone_set_id
    db.flush()
    [first] = rules_of(db, mine.tone_set_id)
    earlier = proposed(client, doc, claude, rule("reword", "tone", first.tone_rule_id, "A."))
    later = proposed(client, doc, claude, rule("reword", "tone", first.tone_rule_id, "B."),
                     text="Actually, B.")
    response = apply(client, doc, later)
    assert response.json()["stale"] == 1
    assert response.json()["updated"][0]["proposals"][0]["state"] == "stale"
    assert earlier["message_id"] == response.json()["updated"][0]["message_id"]
