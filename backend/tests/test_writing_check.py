"""Checking text against the writing rules (app/writing_check.py), with a stand-in for Claude."""

import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode
from app.models import Skill, ToneRule, ToneSet, WritingRule, WritingRuleKind
from app.writing_check import CheckText, Issue, Review, Reviewed, check, find_terms
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add

TERMS = ["leverage", "elevate", "dynamic", "results-driven", "proven track record", "realm",
         "I am excited to apply"]


@pytest.mark.parametrize(("text", "found"), [
    ("Leveraged Kafka to cut latency.", [("leverage", "Leveraged")]),
    ("leveraging", [("leverage", "leveraging")]),
    ("Elevating the team's work.", [("elevate", "Elevating")]),
    ("elevated privileges", [("elevate", "elevated")]),
    ("Dynamic programming.", [("dynamic", "Dynamic")]),
    ("A results driven lead.", [("results-driven", "results driven")]),
    ("A results-driven lead.", [("results-driven", "results-driven")]),
    ("A proven\ntrack record.", [("proven track record", "proven\ntrack record")]),
    ("I’m excited. I am excited to apply.", [("I am excited to apply", "I am excited to apply")]),
    ("Built with Realm.", [("realm", "Realm")]),
])
def test_find_terms(text: str, found: list[tuple[str, str]]) -> None:
    assert find_terms(text, TERMS) == found


@pytest.mark.parametrize("text", [
    "Leverages", "Used Kafka.", "elevator pitch", "realms-of", "dynamical", "proven record",
    "unleveraged",
])
def test_find_terms_whole_words_only(text: str) -> None:
    # "Leverages" is the word itself; the rest aren't.
    found = find_terms(text, TERMS)
    assert found == ([("leverage", "Leverages")] if text == "Leverages" else [])


def rules(db: Session, account_id: int, *, patterns: bool = True) -> None:
    for term in ("leverage", "dynamic"):
        add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term, rule_text=term))
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term, rule_text="robust",
                        active=False))
    if patterns:
        add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern,
                            rule_text="em dashes used for drama"))


def claude(reply: Review | Exception) -> tuple[SimpleNamespace, FakeMessages]:
    messages = FakeMessages(reply=reply)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def sent(messages: FakeMessages) -> list[dict]:
    content = messages.calls[0]["messages"][0]["content"]
    return json.loads(content.split("<texts>\n")[1].split("\n</texts>")[0])


def test_nothing_to_find_asks_nothing(db: Session, account_id: int) -> None:
    rules(db, account_id, patterns=False)
    client, messages = claude(Review(texts=[]))
    checked = check(db, client, account_id, [CheckText(key=1, text="Built a robust API.",
                                                       claude=True)], step="test")
    # "robust" is switched off, and with no patterns or tone there's nothing to ask about.
    assert messages.calls == []
    assert checked[1].text == "Built a robust API." and checked[1].flags == []


def test_found_terms_and_rules_go_to_claude(db: Session, account_id: int) -> None:
    rules(db, account_id)
    tone = add(db, ToneSet(account_id=account_id, name="Tech"))
    add(db, ToneRule(tone_set_id=tone.tone_set_id, rule_text="Lead with tools", position=1))
    add(db, Skill(account_id=account_id, skill_name="Dynamic programming"))
    client, messages = claude(Review(texts=[]))
    check(db, client, account_id, [
        CheckText(key=1, text="Leveraged Kafka.", claude=True),
        CheckText(key=2, text="Wrote tests.", claude=False),
        CheckText(key=3, text="   ", claude=True),
    ], step="test", posting="Build dynamic systems.", tone_set_id=tone.tone_set_id)
    request = messages.calls[0]
    assert request["output_config"] == {"effort": "low"}
    assert "em dashes used for drama" in request["system"]
    assert "Lead with tools" in request["system"]
    assert sent(messages) == [
        {"key": 1, "text": "Leveraged Kafka.", "written_by": "assistant",
         "found_terms": ["leverage"]},
        {"key": 2, "text": "Wrote tests.", "written_by": "the person", "found_terms": []},
    ]
    content = request["messages"][0]["content"]
    assert "Dynamic programming" in content and "Build dynamic systems." in content


def test_claude_text_is_fixed(db: Session, account_id: int) -> None:
    rules(db, account_id)
    client, _ = claude(Review(texts=[Reviewed(
        key=1, issues=[Issue(rule="leverage", quote="Leveraged", why="Filler for used.")],
        fixed_text=" Used  Kafka. ")]))
    checked = check(db, client, account_id, [CheckText(key=1, text="Leveraged Kafka.",
                                                       claude=True)], step="test")
    assert checked[1].model_dump() == {"key": 1, "text": "Used Kafka.", "fixed": True,
                                       "flags": []}


def test_a_fix_with_new_filler_is_not_used(db: Session, account_id: int) -> None:
    rules(db, account_id)
    client, _ = claude(Review(texts=[Reviewed(
        key=1, issues=[Issue(rule="em dashes used for drama", quote="— fast", why="Drama.")],
        fixed_text="Leveraged Kafka, fast.")]))
    checked = check(db, client, account_id, [CheckText(key=1, text="Used Kafka — fast.",
                                                       claude=True)], step="test")
    assert checked[1].fixed is False and checked[1].text == "Used Kafka — fast."
    assert [flag.model_dump() for flag in checked[1].flags] == [
        {"kind": "pattern", "rule": "em dashes used for drama", "quote": "— fast",
         "why": "Drama."}]


def test_a_real_term_stays_in_the_fix(db: Session, account_id: int) -> None:
    rules(db, account_id)
    # "dynamic" is a real term here (not an issue), so the fix may keep it.
    client, _ = claude(Review(texts=[Reviewed(
        key=1, issues=[Issue(rule="leverage", quote="Leveraged", why="Filler.")],
        fixed_text="Used dynamic programming.")]))
    checked = check(db, client, account_id, [CheckText(
        key=1, text="Leveraged dynamic programming.", claude=True)], step="test")
    assert checked[1].fixed is True and checked[1].text == "Used dynamic programming."


def test_the_persons_text_is_only_flagged(db: Session, account_id: int) -> None:
    rules(db, account_id)
    client, _ = claude(Review(texts=[Reviewed(
        key=1, issues=[Issue(rule="Leverage", quote="", why="Filler for used.")],
        fixed_text="Used Kafka.")]))
    checked = check(db, client, account_id, [CheckText(key=1, text="Leveraged Kafka.",
                                                       claude=False)], step="test")
    assert checked[1].text == "Leveraged Kafka." and checked[1].fixed is False
    # The rule as written, and the matched words when Claude gives none.
    assert [(flag.kind, flag.rule, flag.quote) for flag in checked[1].flags] == [
        ("term", "leverage", "Leveraged")]


def test_unknown_rules_and_terms_not_found_are_left_out(db: Session, account_id: int) -> None:
    rules(db, account_id)
    tone = add(db, ToneSet(account_id=account_id, name="Tech"))
    add(db, ToneRule(tone_set_id=tone.tone_set_id, rule_text="Lead with tools", position=1))
    client, _ = claude(Review(texts=[Reviewed(key=1, issues=[
        Issue(rule="synergy", quote="x", why="Not a rule."),
        # "dynamic" is a rule, but code didn't find it in this text.
        Issue(rule="dynamic", quote="x", why="Not here."),
        Issue(rule="lead with tools", quote="Wrote", why="Starts with a duty."),
        Issue(rule="Lead with tools", quote="Wrote", why="Again."),
    ], fixed_text=""), Reviewed(key=9, issues=[], fixed_text="")]))
    checked = check(db, client, account_id, [CheckText(key=1, text="Wrote tests.",
                                                       claude=True)],
                    step="test", tone_set_id=tone.tone_set_id)
    assert [(flag.kind, flag.rule) for flag in checked[1].flags] == [("tone", "Lead with tools")]
    assert set(checked) == {1}


def test_claude_failing_is_ai_unavailable(db: Session, account_id: int) -> None:
    rules(db, account_id)
    request = httpx.Request("POST", "https://api.anthropic.com")
    client, _ = claude(anthropic.APIConnectionError(request=request))
    with pytest.raises(AppError) as raised:
        check(db, client, account_id, [CheckText(key=1, text="Wrote tests.", claude=True)],
              step="test")
    assert raised.value.code == ErrorCode.AI_UNAVAILABLE
