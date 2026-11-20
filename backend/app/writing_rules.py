"""Changes to the account's writing rules that more than one place makes: the Writing rules page
(app/routers/writing_rules.py) and a rule the user applies from the chat (app/rule_proposals.py).
"""

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
