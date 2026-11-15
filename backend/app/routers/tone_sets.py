"""Tones (tone sets) and the rules each one lists (docs/WRITING_RULES.md, "Tone rules";
app/tones.py).

A resume or cover letter can use one tone (tone_set_id), which steers the suggestions made for
it. The four built-in tones (no account) are every account's to use and to take rules from, but
they can't be renamed, edited, hidden, or deleted (BUILT_IN_PROTECTED). A tone is saved whole:
its name and its list of rules, in order, each a saved rule by id or new text (a saved rule with
the same text is reused). Editing one follows "Changing an item" in docs/FRONTEND_CHECKS.md, so a
sent version keeps the tone it was written with: resumes and cover letters in progress change
only if the user picks them (apply_to). Unless every one is picked and nothing sent uses it, the
edit is saved as a new tone with the name in the form, and the original is renamed to
`earlier_name`; only the picked ones switch to the new one. Names are unique, counting the
built-in ones (DUPLICATE). Deleting a tone deletes only its list: its rules stay in the library,
and the resumes and cover letters that used it keep going with no tone.
"""

from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, model_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.account import AccountId
from app.db import DbSession
from app.documents import latest_tone_id
from app.errors import AppError, ErrorCode
from app.hiding import HiddenIn, refuse_delete_if_sent, set_hidden
from app.library import check_ids, check_unique_name
from app.models import ToneRule, ToneSet
from app.schemas import OptionalText, RequiredText
from app.tones import (
    USED_BY,
    check_earlier_name,
    find_or_add_rule,
    get_tone_item,
    protect_built_in,
    rules_of,
    set_rules,
    split_tone,
    visible,
)
from app.usage import DocRef, Use, column_uses, edit_choice

router = APIRouter(prefix="/api/tone-sets", tags=["tone sets"])


class ToneSetIn(BaseModel):
    name: RequiredText(100)


class ToneRuleRef(BaseModel):
    tone_rule_id: int
    rule_text: str
    # So the tone's dialog can leave a hidden rule out of its Add picker.
    hidden: bool
    built_in: bool


class RuleChoice(BaseModel):
    """One rule in a tone's list: a saved rule by id, or new text."""

    tone_rule_id: int | None = None
    rule_text: OptionalText()

    @model_validator(mode="after")
    def one_of(self) -> RuleChoice:
        if (self.tone_rule_id is None) == (self.rule_text is None):
            raise ValueError("give either a saved rule's id or the text of a new rule")
        return self


class ToneSetChange(ToneSetIn):
    # Every rule the tone lists, in order.
    rules: list[RuleChoice]
    # The resumes and cover letters in progress that get the change; the rest keep the original.
    apply_to: list[DocRef] = []
    # The original's new name, when the edit is saved as a new tone.
    earlier_name: OptionalText(100)


class ToneSetOut(ToneSetIn):
    tone_set_id: int
    hidden: bool
    built_in: bool
    created_at: datetime
    rules: list[ToneRuleRef]
    used_by: list[Use]


def to_out(db: Session, sets: list[ToneSet]) -> list[ToneSetOut]:
    used_by = column_uses(db, USED_BY, [tone_set.tone_set_id for tone_set in sets])
    return [ToneSetOut(tone_set_id=tone_set.tone_set_id, hidden=tone_set.hidden, name=tone_set.name,
                       built_in=tone_set.account_id is None, created_at=tone_set.created_at,
                       rules=[ToneRuleRef(tone_rule_id=rule.tone_rule_id, rule_text=rule.rule_text,
                                          hidden=rule.hidden, built_in=rule.account_id is None)
                              for rule in rules_of(db, tone_set.tone_set_id)],
                       used_by=used_by[tone_set.tone_set_id])
            for tone_set in sets]


def one_out(db: Session, tone_set: ToneSet) -> ToneSetOut:
    return to_out(db, [tone_set])[0]


def chosen_rules(db: Session, account_id: int, current: list[int],
                 rules: list[RuleChoice]) -> list[int]:
    """The tone's rules as ids, in order: saved ones checked (the account's own or built-in,
    and a hidden one only if the tone already lists it), new text matched to a saved rule or
    added. The same rule twice is DUPLICATE."""
    saved = [rule.tone_rule_id for rule in rules if rule.tone_rule_id is not None]
    check_ids(db, ToneRule, ToneRule.tone_rule_id, saved, account_id, field="rules",
              allow_built_in=True)
    hidden = set(db.scalars(select(ToneRule.tone_rule_id).where(
        ToneRule.tone_rule_id.in_(saved), ToneRule.hidden)))
    if hidden - set(current):
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "A hidden rule can't be added to a tone. Unhide it first.", field="rules")
    ids = [rule.tone_rule_id if rule.tone_rule_id is not None
           else find_or_add_rule(db, account_id, rule.rule_text).tone_rule_id
           for rule in rules]
    if len(set(ids)) != len(ids):
        raise AppError(ErrorCode.DUPLICATE, "The same rule is in this tone twice.", field="rules")
    return ids


@router.get("")
def list_sets(db: DbSession, account_id: AccountId) -> list[ToneSetOut]:
    """The built-in tones first, by their fixed ids (Professional first), then the account's,
    by name."""
    sets = db.scalars(select(ToneSet).where(visible(ToneSet, account_id))
                      .order_by(ToneSet.account_id.is_not(None),
                                case((ToneSet.account_id.is_(None), ToneSet.tone_set_id)),
                                func.lower(ToneSet.name), ToneSet.tone_set_id)).all()
    return to_out(db, list(sets))


class DefaultTone(BaseModel):
    tone_set_id: int


@router.get("/default")
def default_tone(db: DbSession, account_id: AccountId) -> DefaultTone:
    """The tone a new resume or cover letter starts with when none is given (app/documents.py,
    latest_tone_id), so a form can start on it."""
    return DefaultTone(tone_set_id=latest_tone_id(db, account_id))


@router.get("/{tone_set_id}")
def get_one(tone_set_id: int, db: DbSession, account_id: AccountId) -> ToneSetOut:
    return one_out(db, get_tone_item(db, ToneSet, tone_set_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_set(body: ToneSetIn, db: DbSession, account_id: AccountId) -> ToneSetOut:
    check_unique_name(db, ToneSet.name, account_id, body.name, "tone")
    tone_set = ToneSet(account_id=account_id, name=body.name)
    db.add(tone_set)
    db.flush()
    return one_out(db, tone_set)


@router.put("/{tone_set_id}")
def update_set(tone_set_id: int, body: ToneSetChange, db: DbSession,
               account_id: AccountId) -> ToneSetOut:
    """Saves the tone's name and rules (see the module docstring for when that's a new tone).

    The response's tone_set_id differs from the one in the url when a new tone was saved.
    """
    tone_set = get_tone_item(db, ToneSet, tone_set_id, account_id)
    protect_built_in(tone_set, "changed")
    current = [rule.tone_rule_id for rule in rules_of(db, tone_set_id)]
    rule_ids = chosen_rules(db, account_id, current, body.rules)
    if body.name == tone_set.name and rule_ids == current:
        return one_out(db, tone_set)
    check_unique_name(db, ToneSet.name, account_id, body.name, "tone",
                      exclude=ToneSet.tone_set_id != tone_set_id)
    in_place, chosen = edit_choice(column_uses(db, USED_BY, [tone_set_id])[tone_set_id],
                                   body.apply_to)
    if in_place:
        tone_set.name = body.name
        set_rules(db, tone_set_id, rule_ids)
        db.refresh(tone_set)
        return one_out(db, tone_set)

    earlier = check_earlier_name(db, account_id, tone_set, body.earlier_name, body.name)
    return one_out(db, split_tone(db, account_id, tone_set, body.name, earlier, rule_ids, chosen))


@router.put("/{tone_set_id}/hidden")
def set_tone_hidden(tone_set_id: int, body: HiddenIn, db: DbSession,
                    account_id: AccountId) -> ToneSetOut:
    """Hides or unhides it (docs/FRONTEND_CHECKS.md, "Hiding"). Nothing that uses it changes."""
    item = get_tone_item(db, ToneSet, tone_set_id, account_id)
    protect_built_in(item, "hidden")
    set_hidden(db, item, body.hidden)
    return one_out(db, item)


@router.delete("/{tone_set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(tone_set_id: int, db: DbSession, account_id: AccountId) -> None:
    """Deletes its list of rules, not the rules. Resumes and cover letters that used it keep
    going without one."""
    item = get_tone_item(db, ToneSet, tone_set_id, account_id)
    protect_built_in(item, "deleted")
    refuse_delete_if_sent(column_uses(db, USED_BY, [tone_set_id])[tone_set_id], "tone")
    db.delete(item)
