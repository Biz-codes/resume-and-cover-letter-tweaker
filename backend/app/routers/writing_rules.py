"""Writing rules: banned terms and patterns applied to every suggestion (docs/WRITING_RULES.md).

Rules steer suggestions and are never printed, so they're always edited in place. Switching
a rule off (active false) keeps it without applying it.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select

from app.account import AccountId, get_owned
from app.db import DbSession
from app.models import WritingRule, WritingRuleKind
from app.schemas import RequiredText

router = APIRouter(prefix="/api/writing-rules", tags=["writing rules"])


class WritingRuleIn(BaseModel):
    kind: WritingRuleKind
    rule_text: RequiredText()
    active: bool = True


class WritingRuleOut(WritingRuleIn):
    writing_rule_id: int


FIELDS = list(WritingRuleIn.model_fields)


def to_out(rule: WritingRule) -> WritingRuleOut:
    return WritingRuleOut(writing_rule_id=rule.writing_rule_id,
                          **{field: getattr(rule, field) for field in FIELDS})


@router.get("")
def list_rules(db: DbSession, account_id: AccountId) -> list[WritingRuleOut]:
    """Terms, then patterns, each oldest first."""
    rules = db.scalars(select(WritingRule).where(WritingRule.account_id == account_id)
                       .order_by(WritingRule.kind, WritingRule.writing_rule_id)).all()
    return [to_out(rule) for rule in rules]


@router.get("/{rule_id}")
def get_one(rule_id: int, db: DbSession, account_id: AccountId) -> WritingRuleOut:
    return to_out(get_owned(db, WritingRule, rule_id, account_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(body: WritingRuleIn, db: DbSession, account_id: AccountId) -> WritingRuleOut:
    rule = WritingRule(account_id=account_id, **body.model_dump())
    db.add(rule)
    db.flush()
    return to_out(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: int, body: WritingRuleIn, db: DbSession,
                account_id: AccountId) -> WritingRuleOut:
    rule = get_owned(db, WritingRule, rule_id, account_id)
    for field in FIELDS:
        setattr(rule, field, getattr(body, field))
    db.flush()
    db.refresh(rule)
    return to_out(rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int, db: DbSession, account_id: AccountId) -> None:
    db.delete(get_owned(db, WritingRule, rule_id, account_id))
