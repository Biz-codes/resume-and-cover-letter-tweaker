"""Tone sets and their ordered tone rules (docs/WRITING_RULES.md, "Tone rules").

A resume or cover letter can use one tone set (tone_set_id), which steers the suggestions
made for it. A set is saved whole: its name and its rules, in order. Editing one follows
"Changing an item" in docs/FRONTEND_CHECKS.md, so a sent version keeps the tone it was written
with: resumes and cover letters in progress change only if the user picks them (apply_to).
Unless every one is picked and nothing sent uses it, the edit is saved as a new set with the
same name or the new one, and only the picked ones switch to it. A rule belongs to one set;
deleting the set deletes its rules, and the resumes and cover letters that used it keep going
with no tone set. A new set, or a new name, can't match another set's name (DUPLICATE); a set
saved from an edit can share its original's name. A version added on purpose copies the
set's rules and needs a new name.
"""

from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.hiding import HiddenIn, refuse_delete_if_sent, set_hidden
from app.library import check_unique_name
from app.models import CoverLetter, Resume, ToneRule, ToneSet
from app.schemas import RequiredText
from app.usage import DocRef, Use, column_uses, edit_choice, switch_unsent_column

router = APIRouter(prefix="/api/tone-sets", tags=["tone sets"])

USED_BY = [Resume.tone_set_id, CoverLetter.tone_set_id]


class ToneSetIn(BaseModel):
    name: RequiredText(100)


class ToneRuleIn(BaseModel):
    rule_text: RequiredText()


class ToneRuleOut(ToneRuleIn):
    tone_rule_id: int


class RuleChange(ToneRuleIn):
    # The rule this one is, or empty for a new rule.
    tone_rule_id: int | None = None


class ToneSetChange(ToneSetIn):
    # Every rule the set keeps, in order; the rest are deleted.
    rules: list[RuleChange]
    # The resumes and cover letters in progress that get the change; the rest keep the original.
    apply_to: list[DocRef] = []


class ToneSetOut(ToneSetIn):
    tone_set_id: int
    hidden: bool
    # When it was added, which tells sets with the same name apart.
    created_at: datetime
    rules: list[ToneRuleOut]
    used_by: list[Use]


def rules_of(db: Session, tone_set_id: int) -> list[ToneRule]:
    return list(db.scalars(select(ToneRule).where(ToneRule.tone_set_id == tone_set_id)
                           .order_by(ToneRule.position, ToneRule.tone_rule_id)))


def to_out(db: Session, sets: list[ToneSet]) -> list[ToneSetOut]:
    used_by = column_uses(db, USED_BY, [tone_set.tone_set_id for tone_set in sets])
    return [ToneSetOut(tone_set_id=tone_set.tone_set_id, hidden=tone_set.hidden, name=tone_set.name,
                       created_at=tone_set.created_at,
                       rules=[ToneRuleOut(tone_rule_id=rule.tone_rule_id,
                                          rule_text=rule.rule_text)
                              for rule in rules_of(db, tone_set.tone_set_id)],
                       used_by=used_by[tone_set.tone_set_id])
            for tone_set in sets]


def one_out(db: Session, tone_set: ToneSet) -> ToneSetOut:
    return to_out(db, [tone_set])[0]


def add_set(db: Session, account_id: int, name: str, rules: list[str]) -> ToneSet:
    tone_set = ToneSet(account_id=account_id, name=name)
    db.add(tone_set)
    db.flush()
    for position, text in enumerate(rules, start=1):
        db.add(ToneRule(tone_set_id=tone_set.tone_set_id, rule_text=text, position=position))
    db.flush()
    return tone_set


def check_rules(current: list[ToneRule], rules: list[RuleChange]) -> None:
    """Each rule id must be one of the set's rules, at most once (VALIDATION_FAILED)."""
    ids = [rule.tone_rule_id for rule in rules if rule.tone_rule_id is not None]
    if len(set(ids)) != len(ids) or not set(ids) <= {rule.tone_rule_id for rule in current}:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "Each rule must be one of this tone's rules, once.", field="rules")


def save_rules(db: Session, tone_set: ToneSet, current: list[ToneRule],
               rules: list[RuleChange]) -> None:
    """Gives the set exactly these rules, in this order."""
    by_id = {rule.tone_rule_id: rule for rule in current}
    kept = {rule.tone_rule_id for rule in rules}
    for rule in current:
        if rule.tone_rule_id not in kept:
            db.delete(rule)
    for position, change in enumerate(rules, start=1):
        if change.tone_rule_id is None:
            db.add(ToneRule(tone_set_id=tone_set.tone_set_id, rule_text=change.rule_text,
                            position=position))
        else:
            rule = by_id[change.tone_rule_id]
            rule.rule_text, rule.position = change.rule_text, position
    db.flush()


@router.get("")
def list_sets(db: DbSession, account_id: AccountId) -> list[ToneSetOut]:
    """By name."""
    sets = db.scalars(select(ToneSet).where(ToneSet.account_id == account_id)
                      .order_by(func.lower(ToneSet.name), ToneSet.tone_set_id)).all()
    return to_out(db, list(sets))


@router.get("/{tone_set_id}")
def get_one(tone_set_id: int, db: DbSession, account_id: AccountId) -> ToneSetOut:
    return one_out(db, get_owned(db, ToneSet, tone_set_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_set(body: ToneSetIn, db: DbSession, account_id: AccountId) -> ToneSetOut:
    check_unique_name(db, ToneSet.name, account_id, body.name, "tone")
    return one_out(db, add_set(db, account_id, body.name, []))


@router.put("/{tone_set_id}")
def update_set(tone_set_id: int, body: ToneSetChange, db: DbSession,
               account_id: AccountId) -> ToneSetOut:
    """Saves the set's name and rules (see the module docstring for when that's a new set).

    The response's tone_set_id differs from the one in the url when a new set was saved.
    """
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    current = rules_of(db, tone_set_id)
    check_rules(current, body.rules)
    if (body.name == tone_set.name
            and [(rule.tone_rule_id, rule.rule_text) for rule in body.rules]
            == [(rule.tone_rule_id, rule.rule_text) for rule in current]):
        return one_out(db, tone_set)
    if body.name.lower() != tone_set.name.lower():
        check_unique_name(db, ToneSet.name, account_id, body.name, "tone",
                          exclude=ToneSet.tone_set_id != tone_set_id)
    in_place, chosen = edit_choice(column_uses(db, USED_BY, [tone_set_id])[tone_set_id],
                                   body.apply_to)
    if in_place:
        tone_set.name = body.name
        save_rules(db, tone_set, current, body.rules)
        db.refresh(tone_set)
        return one_out(db, tone_set)

    replacement = add_set(db, account_id, body.name, [rule.rule_text for rule in body.rules])
    if chosen:
        for column in USED_BY:
            switch_unsent_column(db, column, tone_set_id, replacement.tone_set_id, only=chosen)
    return one_out(db, replacement)


@router.put("/{tone_set_id}/hidden")
def set_tone_hidden(tone_set_id: int, body: HiddenIn, db: DbSession,
                    account_id: AccountId) -> ToneSetOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"). Nothing that uses it changes."""
    item = get_owned(db, ToneSet, tone_set_id, account_id)
    set_hidden(db, item, body.hidden)
    return one_out(db, item)


@router.delete("/{tone_set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(tone_set_id: int, db: DbSession, account_id: AccountId) -> None:
    """Deletes its rules too. Resumes and cover letters that used it keep going without one."""
    item = get_owned(db, ToneSet, tone_set_id, account_id)
    refuse_delete_if_sent(column_uses(db, USED_BY, [tone_set_id])[tone_set_id], "tone")
    db.delete(item)
