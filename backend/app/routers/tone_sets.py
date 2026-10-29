"""Tone sets and their ordered tone rules (docs/WRITING_RULES.md, "Tone rules").

A resume or cover letter can use one tone set (tone_set_id), which steers the suggestions
made for it. Tone rules are never printed, so sets and rules are always edited in place, even
when a sent version uses the set. A rule belongs to one set; deleting the set deletes its
rules, and the resumes and cover letters that used it keep going with no tone set.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.account import AccountId, get_owned
from app.db import DbSession
from app.errors import AppError, ErrorCode
from app.models import CoverLetter, Resume, ToneRule, ToneSet
from app.schemas import RequiredText
from app.usage import Use, column_uses

router = APIRouter(prefix="/api/tone-sets", tags=["tone sets"])

USED_BY = [Resume.tone_set_id, CoverLetter.tone_set_id]


class ToneSetIn(BaseModel):
    name: RequiredText(100)


class ToneRuleIn(BaseModel):
    rule_text: RequiredText()


class ToneRuleOut(ToneRuleIn):
    tone_rule_id: int


class ToneSetOut(ToneSetIn):
    tone_set_id: int
    rules: list[ToneRuleOut]
    used_by: list[Use]


class RuleOrder(BaseModel):
    tone_rule_ids: list[int]


def rules_of(db: Session, tone_set_id: int) -> list[ToneRule]:
    return list(db.scalars(select(ToneRule).where(ToneRule.tone_set_id == tone_set_id)
                           .order_by(ToneRule.position, ToneRule.tone_rule_id)))


def to_out(db: Session, sets: list[ToneSet]) -> list[ToneSetOut]:
    used_by = column_uses(db, USED_BY, [tone_set.tone_set_id for tone_set in sets])
    return [ToneSetOut(tone_set_id=tone_set.tone_set_id, name=tone_set.name,
                       rules=[ToneRuleOut(tone_rule_id=rule.tone_rule_id,
                                          rule_text=rule.rule_text)
                              for rule in rules_of(db, tone_set.tone_set_id)],
                       used_by=used_by[tone_set.tone_set_id])
            for tone_set in sets]


def one_out(db: Session, tone_set: ToneSet) -> ToneSetOut:
    return to_out(db, [tone_set])[0]


def get_rule(db: Session, tone_set: ToneSet, rule_id: int) -> ToneRule:
    rule = db.get(ToneRule, rule_id)
    if rule is None or rule.tone_set_id != tone_set.tone_set_id:
        raise AppError(ErrorCode.NOT_FOUND)
    return rule


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
    tone_set = ToneSet(account_id=account_id, name=body.name)
    db.add(tone_set)
    db.flush()
    return one_out(db, tone_set)


@router.put("/{tone_set_id}")
def rename_set(tone_set_id: int, body: ToneSetIn, db: DbSession,
               account_id: AccountId) -> ToneSetOut:
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    tone_set.name = body.name
    db.flush()
    db.refresh(tone_set)
    return one_out(db, tone_set)


@router.delete("/{tone_set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(tone_set_id: int, db: DbSession, account_id: AccountId) -> None:
    """Deletes its rules too. Resumes and cover letters that used it keep going without one."""
    db.delete(get_owned(db, ToneSet, tone_set_id, account_id))


@router.post("/{tone_set_id}/rules", status_code=status.HTTP_201_CREATED)
def add_rule(tone_set_id: int, body: ToneRuleIn, db: DbSession,
             account_id: AccountId) -> ToneSetOut:
    """Adds the rule last in the set."""
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    last = db.scalar(select(func.max(ToneRule.position)).where(ToneRule.tone_set_id == tone_set_id))
    db.add(ToneRule(tone_set_id=tone_set_id, rule_text=body.rule_text, position=(last or 0) + 1))
    db.flush()
    return one_out(db, tone_set)


@router.put("/{tone_set_id}/rules")
def order_rules(tone_set_id: int, body: RuleOrder, db: DbSession,
                account_id: AccountId) -> ToneSetOut:
    """Puts the set's rules in this order. The list must hold every rule in the set, once."""
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    current = {rule.tone_rule_id for rule in rules_of(db, tone_set_id)}
    if len(body.tone_rule_ids) != len(current) or set(body.tone_rule_ids) != current:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "The list must hold every rule in the set, once each.",
                       field="tone_rule_ids")
    for position, rule_id in enumerate(body.tone_rule_ids, start=1):
        db.execute(update(ToneRule).where(ToneRule.tone_rule_id == rule_id)
                   .values(position=position))
    return one_out(db, tone_set)


@router.put("/{tone_set_id}/rules/{rule_id}")
def update_rule(tone_set_id: int, rule_id: int, body: ToneRuleIn, db: DbSession,
                account_id: AccountId) -> ToneSetOut:
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    get_rule(db, tone_set, rule_id).rule_text = body.rule_text
    db.flush()
    return one_out(db, tone_set)


@router.delete("/{tone_set_id}/rules/{rule_id}")
def delete_rule(tone_set_id: int, rule_id: int, db: DbSession,
                account_id: AccountId) -> ToneSetOut:
    tone_set = get_owned(db, ToneSet, tone_set_id, account_id)
    db.delete(get_rule(db, tone_set, rule_id))
    db.flush()
    return one_out(db, tone_set)
