"""Tone rules: library items that any tone can list (app/tones.py; docs/DATABASE.md, tone_rule).

A rule's uses are the resumes and cover letters whose tone lists it. Editing its text follows
"Changing an item" in docs/FRONTEND_CHECKS.md: in place only when every one in progress that
uses it is picked (apply_to) and no sent one does. Otherwise it's saved as a new rule, and each
tone that lists the original gets it by that tone's own uses:
- no document uses the tone, or only picked ones: it lists the new rule in the original's place;
- picked ones and others (or sent ones) use it: it's saved as a new tone with its name, listing
  the new rule, and the original is renamed to the name in `earlier_names` for it; the picked
  ones switch to the new tone;
- no picked one uses it: it keeps the original.

The account holds each rule once: a new rule matching a saved one's text (ignoring spacing and
capitals) is that rule, and an edit can't make a rule match another (DUPLICATE). Deleting a rule
takes it out of every tone; it's refused when a sent version's tone lists it (VERSION_LOCKED).
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.hiding import HiddenIn, refuse_delete_if_sent, set_hidden
from app.models import ToneRule, ToneSet, ToneSetToneRule
from app.schemas import RequiredText
from app.tones import (
    USED_BY,
    check_earlier_name,
    find_or_add_rule,
    matching_rule,
    rules_of,
    set_rules,
    split_tone,
)
from app.usage import DocRef, Use, column_uses, edit_choice

router = APIRouter(prefix="/api/tone-rules", tags=["tone rules"])


class ToneRuleIn(BaseModel):
    rule_text: RequiredText()


class ToneRuleChange(ToneRuleIn):
    # The resumes and cover letters in progress that get the change; the rest keep the original.
    apply_to: list[DocRef] = []
    # For each tone the edit saves as a new tone (used by picked and other documents): the name
    # its original takes, by the original's id.
    earlier_names: dict[int, str] = {}


class ToneRef(BaseModel):
    tone_set_id: int
    name: str
    # The resumes and cover letters using this tone, so the page can tell which tones an edit
    # saves as new ones (and ask for their earlier names).
    used_by: list[Use]


class ToneRuleOut(ToneRuleIn):
    tone_rule_id: int
    hidden: bool
    tones: list[ToneRef]
    used_by: list[Use]


def tones_listing(db: Session, rule_ids: list[int]) -> dict[int, list[ToneSet]]:
    found: dict[int, list[ToneSet]] = {rule_id: [] for rule_id in rule_ids}
    for rule_id, tone_set in db.execute(
            select(ToneSetToneRule.tone_rule_id, ToneSet)
            .join(ToneSet, ToneSet.tone_set_id == ToneSetToneRule.tone_set_id)
            .where(ToneSetToneRule.tone_rule_id.in_(rule_ids))
            .order_by(func.lower(ToneSet.name), ToneSet.tone_set_id)):
        found[rule_id].append(tone_set)
    return found


def to_out(db: Session, rules: list[ToneRule]) -> list[ToneRuleOut]:
    tones = tones_listing(db, [rule.tone_rule_id for rule in rules])
    tone_ids = sorted({tone.tone_set_id for listed in tones.values() for tone in listed})
    used_by = column_uses(db, USED_BY, tone_ids)
    return [ToneRuleOut(
        tone_rule_id=rule.tone_rule_id, rule_text=rule.rule_text, hidden=rule.hidden,
        tones=[ToneRef(tone_set_id=tone.tone_set_id, name=tone.name,
                       used_by=used_by[tone.tone_set_id]) for tone in tones[rule.tone_rule_id]],
        used_by=[use for tone in tones[rule.tone_rule_id] for use in used_by[tone.tone_set_id]])
        for rule in rules]


def one_out(db: Session, rule: ToneRule) -> ToneRuleOut:
    return to_out(db, [rule])[0]


@router.get("")
def list_rules(db: DbSession, account_id: AccountId) -> list[ToneRuleOut]:
    rules = db.scalars(select(ToneRule).where(ToneRule.account_id == account_id)
                       .order_by(func.lower(ToneRule.rule_text), ToneRule.tone_rule_id)).all()
    return to_out(db, list(rules))


@router.get("/{tone_rule_id}")
def get_one(tone_rule_id: int, db: DbSession, account_id: AccountId) -> ToneRuleOut:
    return one_out(db, get_owned(db, ToneRule, tone_rule_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(body: ToneRuleIn, db: DbSession, account_id: AccountId) -> ToneRuleOut:
    """A new rule, or the saved one with the same text."""
    return one_out(db, find_or_add_rule(db, account_id, body.rule_text))


@router.put("/{tone_rule_id}")
def update_rule(tone_rule_id: int, body: ToneRuleChange, db: DbSession,
                account_id: AccountId) -> ToneRuleOut:
    """Saves the rule's text (see the module docstring for when that's a new rule).

    The response's tone_rule_id differs from the one in the url when a new rule was saved.
    """
    rule = get_owned(db, ToneRule, tone_rule_id, account_id)
    text = " ".join(body.rule_text.split())
    if text == rule.rule_text:
        return one_out(db, rule)
    if matching_rule(db, account_id, text, exclude=tone_rule_id) is not None:
        raise AppError(ErrorCode.DUPLICATE, "There's already a rule with this text. Add that one "
                       "to the tone instead.", field="rule_text")
    tones = tones_listing(db, [tone_rule_id])[tone_rule_id]
    uses_by_tone = column_uses(db, USED_BY, [tone.tone_set_id for tone in tones])
    all_uses = [use for tone in tones for use in uses_by_tone[tone.tone_set_id]]
    in_place, chosen = edit_choice(all_uses, body.apply_to)
    if in_place:
        rule.rule_text = text
        db.flush()
        db.refresh(rule)
        return one_out(db, rule)

    replacement = ToneRule(account_id=account_id, rule_text=text)
    db.add(replacement)
    db.flush()
    for tone in tones:
        uses = {(use.kind, use.id) for use in uses_by_tone[tone.tone_set_id]}
        picked = uses & chosen
        rule_ids = [replacement.tone_rule_id if listed.tone_rule_id == tone_rule_id
                    else listed.tone_rule_id for listed in rules_of(db, tone.tone_set_id)]
        if uses <= chosen:
            # No document uses it, or only picked ones (never a sent one, which can't be picked).
            set_rules(db, tone.tone_set_id, rule_ids)
        elif picked:
            earlier = check_earlier_name(db, account_id, tone, body.earlier_names.get(
                tone.tone_set_id), tone.name, field="earlier_names")
            split_tone(db, account_id, tone, tone.name, earlier, rule_ids, picked)
    return one_out(db, replacement)


@router.put("/{tone_rule_id}/hidden")
def set_rule_hidden(tone_rule_id: int, body: HiddenIn, db: DbSession,
                    account_id: AccountId) -> ToneRuleOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"). The tones that list it keep it."""
    item = get_owned(db, ToneRule, tone_rule_id, account_id)
    set_hidden(db, item, body.hidden)
    return one_out(db, item)


@router.delete("/{tone_rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(tone_rule_id: int, db: DbSession, account_id: AccountId) -> None:
    """Takes it out of every tone, then deletes it."""
    item = get_owned(db, ToneRule, tone_rule_id, account_id)
    refuse_delete_if_sent(one_out(db, item).used_by, "tone rule")
    db.delete(item)
