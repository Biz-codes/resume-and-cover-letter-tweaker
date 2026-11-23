"""Changes to the account's writing rules that more than one place makes: the Writing rules page
(app/routers/writing_rules.py) and a rule the user applies from the chat (app/rule_proposals.py);
and which of a library item's saved flags are shown (shown_flags): a rule switched off keeps its
flags on the library's text, hidden until it's switched on again.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BulletPoint, NarrativeContent, WritingRule


def delete_writing_rule(db: Session, account_id: int, rule: WritingRule) -> None:
    """Deletes the rule, and takes it off the account's bullets and narrative content it flags
    (their `flags` name each rule by its text), unless another of the account's rules has the
    same text and kind. Text that broke only this rule is left checked, breaking none ([])."""
    kind, text = rule.kind, rule.rule_text
    db.delete(rule)
    db.flush()
    twin = db.scalar(select(WritingRule.writing_rule_id).where(
        WritingRule.account_id == account_id, WritingRule.kind == kind,
        WritingRule.rule_text == text).limit(1))
    if twin is not None:
        return
    flag = {"rule": text, "kind": kind.value}
    for model in (BulletPoint, NarrativeContent):
        for item in db.scalars(select(model).where(model.account_id == account_id,
                                                   model.flags.contains([flag]))):
            item.flags = [kept for kept in item.flags
                          if (kept.get("rule"), kept.get("kind")) != (flag["rule"], flag["kind"])]


def switched_off(db: Session, account_id: int) -> set[tuple[str, str]]:
    """The (kind, text) of the account's rules that are switched off, unless another of its
    rules with the same kind and text is on."""
    rules = db.execute(select(WritingRule.kind, WritingRule.rule_text, WritingRule.active)
                       .where(WritingRule.account_id == account_id)).all()
    on = {(kind.value, text) for kind, text, active in rules if active}
    return {(kind.value, text) for kind, text, active in rules if not active} - on


def shown_flags(flags: list[dict[str, Any]] | None,
                off: set[tuple[str, str]]) -> list[dict[str, Any]] | None:
    """A library item's saved flags without those for rules switched off (`off`, from
    switched_off). None (never checked) stays None."""
    if flags is None or not off:
        return flags
    return [flag for flag in flags if (flag.get("kind"), flag.get("rule")) not in off]
