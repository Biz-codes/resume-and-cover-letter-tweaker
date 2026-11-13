"""Tones and their rules, shared by the tone and tone rule endpoints, Claude's instructions, and
the writing check (docs/DATABASE.md, tone_set, tone_rule, and tone_set_tone_rule).

A tone rule stands alone and each tone lists its rules in order (tone_set_tone_rule), so one
rule can be in many tones. A tone's list is the tone itself: a resume or cover letter follows
every rule its tone lists. The account holds each rule once: text that matches a saved rule,
ignoring spacing and capitals, is that rule.

Tone names are unique in the account. When an edit saves a new tone (docs/FRONTEND_CHECKS.md,
"Changing an item"), the new one takes the name and the original, which the documents that keep
it still use, is renamed to a name the user gives (split_tone).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, ErrorCode
from app.library import check_unique_name
from app.models import CoverLetter, Resume, ToneRule, ToneSet, ToneSetToneRule
from app.usage import switch_unsent_column

USED_BY = [Resume.tone_set_id, CoverLetter.tone_set_id]


def same_text(text: str) -> str:
    """How two rules' text is compared: ignoring spacing and capitals."""
    return " ".join(text.split()).lower()


def rules_of(db: Session, tone_set_id: int) -> list[ToneRule]:
    """The tone's rules, in order."""
    return list(db.scalars(
        select(ToneRule)
        .join(ToneSetToneRule, ToneSetToneRule.tone_rule_id == ToneRule.tone_rule_id)
        .where(ToneSetToneRule.tone_set_id == tone_set_id)
        .order_by(ToneSetToneRule.position)))


def rule_texts(db: Session, tone_set_id: int | None) -> list[str]:
    """What the tone tells Claude, in order; none without a tone."""
    if tone_set_id is None:
        return []
    return [rule.rule_text for rule in rules_of(db, tone_set_id)]


def matching_rule(db: Session, account_id: int, text: str,
                  exclude: int | None = None) -> ToneRule | None:
    """The account's saved rule with this text (hidden ones too), if there is one."""
    key = same_text(text)
    for rule in db.scalars(select(ToneRule).where(ToneRule.account_id == account_id)
                           .order_by(ToneRule.tone_rule_id)):
        if rule.tone_rule_id != exclude and same_text(rule.rule_text) == key:
            return rule
    return None


def find_or_add_rule(db: Session, account_id: int, text: str) -> ToneRule:
    """The saved rule with this text, or a new one."""
    rule = matching_rule(db, account_id, text)
    if rule is None:
        rule = ToneRule(account_id=account_id, rule_text=" ".join(text.split()))
        db.add(rule)
        db.flush()
    return rule


def set_rules(db: Session, tone_set_id: int, rule_ids: list[int]) -> None:
    """Gives the tone exactly these rules, in this order."""
    db.execute(ToneSetToneRule.__table__.delete().where(
        ToneSetToneRule.tone_set_id == tone_set_id))
    db.add_all(ToneSetToneRule(tone_set_id=tone_set_id, tone_rule_id=rule_id, position=position)
               for position, rule_id in enumerate(rule_ids, start=1))
    db.flush()


def check_earlier_name(db: Session, account_id: int, tone_set: ToneSet, name: str | None,
                       new_name: str, field: str = "earlier_name") -> str:
    """The name the original tone takes when an edit saves a new one: required, and new in the
    account (it can't be the name the new tone takes, either)."""
    name = (name or "").strip()
    if not name:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       f'Name the earlier version of "{tone_set.name}" that the other resumes and '
                       "cover letters keep.", field=field)
    if len(name) > 100:
        raise AppError(ErrorCode.VALIDATION_FAILED, "A tone's name can be up to 100 characters.",
                       field=field)
    if name.lower() == new_name.lower():
        raise AppError(ErrorCode.DUPLICATE, f'The new version is named "{new_name}". Give the '
                       "earlier one another name.", field=field)
    try:
        check_unique_name(db, ToneSet.name, account_id, name, "tone",
                          exclude=ToneSet.tone_set_id != tone_set.tone_set_id)
    except AppError as error:
        error.field = field
        raise
    return name


def split_tone(db: Session, account_id: int, original: ToneSet, name: str, earlier_name: str,
               rule_ids: list[int], chosen: set[tuple[str, int]]) -> ToneSet:
    """Save the edit as a new tone named `name` with these rules, rename the original to
    `earlier_name` (checked by the caller), and switch the chosen documents in progress to the
    new one. The rest, and every sent one, keep the original."""
    original.name = earlier_name
    db.flush()
    replacement = ToneSet(account_id=account_id, name=name)
    db.add(replacement)
    db.flush()
    set_rules(db, replacement.tone_set_id, rule_ids)
    if chosen:
        for column in USED_BY:
            switch_unsent_column(db, column, original.tone_set_id, replacement.tone_set_id,
                                 only=chosen)
    return replacement
