"""Rules in the chat (docs/APP_FLOW.md, "Working with Claude at every level"; phase 5 step 7 in
docs/BUILD_PLAN.md): Claude can propose adding, rewording, or removing a rule in the document's
tone, or adding or removing a banned word or phrase (a `term` writing rule), with the
`propose_rule` tool. Each is a card, like the chat's changes to the document, stored with the
reply's other proposals (`kind` "rule"); nothing changes until the user applies it.

Applying one is a single request (apply_rule): a banned word added (or switched back on) or
deleted, with its flags taken off the library (app/writing_rules.py); or the tone saved with its
new rules the way its dialog saves it (app/routers/tone_sets.py, update_set): in place when every
document using it gets the change, otherwise as a new tone, which the chosen documents and this
one switch to, the original renamed (`earlier_name`). A built-in tone can't change, so the change
is a copy of it, named by the user (`copy_name`), which this document switches to.

The rules Claude reads (app/chat.py, rules_json) come with their ids, and the chat sends them again
whenever they change, so Claude always proposes against the rules as they are.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.documents import Kind
from app.errors import AppError, ErrorCode
from app.library import check_unique_name
from app.models import ToneSet, WritingRule, WritingRuleKind
from app.tones import (
    USED_BY,
    check_earlier_name,
    find_or_add_rule,
    rules_of,
    same_text,
    set_rules,
    split_tone,
)
from app.usage import DocRef, column_uses, edit_choice
from app.writing_rules import delete_writing_rule

RULE_MAX = 1000
NAME_MAX = 100


class ProposedRule(BaseModel):
    """Claude's `propose_rule` tool input. Strings and numbers, not nullable ones: "" and 0 are
    "none", which keeps the tool's grammar small."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["add", "reword", "remove"]
    target: Literal["tone", "banned"] = Field(description=(
        'A rule in the document\'s tone, or a banned word or phrase ("banned"; add or remove '
        "only)."))
    rule_id: int = Field(description="The rule's id in <rules> (reword, remove), or 0 (add).")
    new_text: str = Field(description=(
        'The rule\'s new text (add, reword): a tone rule as an instruction ("Name the tools"), '
        'a banned word or phrase as just the words; otherwise "".'))
    reason: str = Field(description="One short sentence saying why.")


class RuleProposal(ProposedRule):
    """A checked rule proposal as stored and shown: what it changes as it read when Claude
    proposed it (`before`, the rule's text for a rewording or removal; the tone's name and
    whether it's built in), and what the user did with it."""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["rule"] = "rule"
    id: str
    before: str = ""
    tone_set_id: int = 0
    tone_name: str = ""
    built_in: bool = False
    state: Literal["pending", "applied", "dismissed", "stale"] = "pending"


RULE_TOOL = {
    "name": "propose_rule",
    "description": (
        "Propose one change to the person's rules: a rule in the document's tone, or a banned "
        "word or phrase. Shown as a card they can apply or dismiss, after your reply text to "
        "them, never instead of it. Nothing changes until they apply it."),
    "strict": True,
    "input_schema": ProposedRule.model_json_schema(),
}


def _banned(db: Session, account_id: int) -> list[WritingRule]:
    return list(db.scalars(select(WritingRule).where(
        WritingRule.account_id == account_id, WritingRule.kind == WritingRuleKind.term)
        .order_by(WritingRule.writing_rule_id)))


def check_rule(db: Session, account_id: int, doc: Any,
               rule: ProposedRule) -> tuple[RuleProposal | None, str]:
    """The proposal as it's shown, or why it can't be (for Claude's next turn)."""
    text = " ".join(rule.new_text.split())
    if rule.action in ("add", "reword"):
        if not text:
            return None, "it has no new text"
        if len(text) > RULE_MAX:
            return None, f"its text is over {RULE_MAX} characters"
    else:
        text = ""
    fields = {**rule.model_dump(), "new_text": text}
    if rule.target == "banned":
        banned = _banned(db, account_id)
        if rule.action == "reword":
            return None, "a banned word is added or removed, not reworded"
        if rule.action == "add":
            if any(same_text(item.rule_text) == same_text(text) and item.active for item in banned):
                return None, "that word or phrase is already banned"
            return RuleProposal(id="", **{**fields, "rule_id": 0}), ""
        found = next((item for item in banned if item.writing_rule_id == rule.rule_id), None)
        if found is None:
            return None, "there's no banned word or phrase with that id"
        return RuleProposal(id="", before=found.rule_text, **fields), ""

    tone = db.get(ToneSet, doc.tone_set_id) if doc.tone_set_id else None
    if tone is None:
        return None, "the document has no tone"
    rules = rules_of(db, tone.tone_set_id)
    about = {"tone_set_id": tone.tone_set_id, "tone_name": tone.name,
             "built_in": tone.account_id is None}
    if rule.action == "add":
        if any(same_text(item.rule_text) == same_text(text) for item in rules):
            return None, "the tone already has that rule"
        return RuleProposal(id="", **{**fields, "rule_id": 0}, **about), ""
    found = next((item for item in rules if item.tone_rule_id == rule.rule_id), None)
    if found is None:
        return None, "the document's tone has no rule with that id"
    if rule.action == "reword" and same_text(found.rule_text) == same_text(text):
        return None, "the new wording is the same as the rule's"
    return RuleProposal(id="", before=found.rule_text, **fields, **about), ""


class RuleApplyIn(BaseModel):
    """The user's choices for a tone rule, as the tone's dialog asks them: the other resumes and
    cover letters using the tone that get the change too (this one always does), the original's
    new name when it's saved as a new tone, or for a built-in tone, the copy's name."""

    apply_to: list[DocRef] = []
    earlier_name: str | None = None
    copy_name: str | None = None


def apply_rule(db: Session, kind: Kind, account_id: int, doc: Any, proposal: RuleProposal,
               choice: RuleApplyIn) -> str:
    """Make the rule change, or refuse it (VALIDATION_FAILED, DUPLICATE) and change nothing.
    Returns what it did, for the notice."""
    if proposal.target == "banned":
        return _apply_banned(db, account_id, proposal)

    tone = db.get(ToneSet, doc.tone_set_id) if doc.tone_set_id else None
    if tone is None or tone.tone_set_id != proposal.tone_set_id:
        what = kind.prefix.replace("_", " ")
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       f'The {what} doesn\'t use the "{proposal.tone_name}" tone anymore, so '
                       "this can't be applied.")
    current = [rule.tone_rule_id for rule in rules_of(db, tone.tone_set_id)]
    rule_ids = _new_rules(db, account_id, current, proposal)

    if tone.account_id is None:
        name = " ".join((choice.copy_name or "").split())
        if not name or len(name) > NAME_MAX:
            raise AppError(ErrorCode.VALIDATION_FAILED,
                           f"Name your copy of the \"{tone.name}\" tone (up to {NAME_MAX} "
                           "characters).", field="copy_name")
        try:
            check_unique_name(db, ToneSet.name, account_id, name, "tone")
        except AppError as error:
            error.field = "copy_name"
            raise
        copy = ToneSet(account_id=account_id, name=name)
        db.add(copy)
        db.flush()
        set_rules(db, copy.tone_set_id, rule_ids)
        doc.tone_set_id = copy.tone_set_id
        return f'Saved the change as your own tone, "{name}", which this one uses now.'

    this_doc = DocRef(kind=kind.prefix, id=getattr(doc, kind.doc_id))
    apply_to = [*choice.apply_to, this_doc]
    in_place, chosen = edit_choice(column_uses(db, USED_BY, [tone.tone_set_id])[tone.tone_set_id],
                                   apply_to, include_sent=True)
    if in_place:
        set_rules(db, tone.tone_set_id, rule_ids)
        return f'Changed the "{tone.name}" tone.'
    name = tone.name
    earlier = check_earlier_name(db, account_id, tone, choice.earlier_name, name)
    split_tone(db, account_id, tone, name, earlier, rule_ids, chosen)
    return (f'Saved the change as a new "{name}" tone, which the ones you chose use now. '
            f'The others keep the earlier one, now "{earlier}".')


def _new_rules(db: Session, account_id: int, current: list[int],
               proposal: RuleProposal) -> list[int]:
    """The tone's rules after the change, as ids, in order."""
    if proposal.action == "add":
        added = find_or_add_rule(db, account_id, proposal.new_text).tone_rule_id
        if added in current:
            raise AppError(ErrorCode.DUPLICATE, "The tone already has that rule.")
        return [*current, added]
    if proposal.rule_id not in current:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "That rule isn't in the tone anymore, so this can't be applied.")
    if proposal.action == "remove":
        return [rule_id for rule_id in current if rule_id != proposal.rule_id]
    reworded = find_or_add_rule(db, account_id, proposal.new_text).tone_rule_id
    if reworded in current and reworded != proposal.rule_id:
        raise AppError(ErrorCode.DUPLICATE, "The tone already has that rule.")
    return [reworded if rule_id == proposal.rule_id else rule_id for rule_id in current]


def _apply_banned(db: Session, account_id: int, proposal: RuleProposal) -> str:
    banned = _banned(db, account_id)
    if proposal.action == "add":
        key = same_text(proposal.new_text)
        same = [item for item in banned if same_text(item.rule_text) == key]
        if any(item.active for item in same):
            raise AppError(ErrorCode.DUPLICATE, f'"{proposal.new_text}" is already banned.')
        if same:
            # Switched off on the Writing rules page: switched back on.
            same[0].active = True
        else:
            db.add(WritingRule(account_id=account_id, kind=WritingRuleKind.term,
                               rule_text=proposal.new_text))
        db.flush()
        return f'Banned "{proposal.new_text}".'
    found = next((item for item in banned if item.writing_rule_id == proposal.rule_id), None)
    if found is None:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       "That word or phrase isn't banned anymore, so this can't be applied.")
    delete_writing_rule(db, account_id, found)
    return f'Took "{proposal.before}" off your banned words.'
