"""Applying or dismissing one of Claude's proposals from the chat (app/chat.py;
docs/FRONTEND_CHECKS.md, "Chat with Claude").

Applying makes an ordinary change to the document's tree, in one transaction: the proposal is
checked again against the document and the library as they are now, the tree is rebuilt with
the change through the same code as Undo (document_tree.restore), and an added item gets the
defaults it would get added by hand (a role's bullets, a section's items). Claude's new or
reworded text becomes a new library row, used in this document only: a rewording is listed
right after its original, and new text under the section, role, or project it goes in. A skill
added under a skill category or project is listed under it in the library too, as on the page
(document_tree.apply_skills), and a new skill is saved the way the page saves one (under its
category, or under "Other" and the project). The page keeps the document as it was for Undo.

Applying one also sets aside every earlier proposal still pending for the same content (`stale`):
one in an earlier reply, or earlier in the same reply, that changes the same section, or the same
item in the same place. And whenever the chat is read (after every change to the document),
a pending one whose section, parent, or item is no longer in the document is set aside too
(set_aside_gone), so removing something by hand folds away the cards about it. Earlier ones
never make a later one stale, and new text (an add with no
item yet) is never the same content as anything. A thread of replies counts too: the card the
user replied to, to get the reply the applied one is in, and so on back up the thread, is set
aside when it makes the same kind of change in the same place, so a summary written from scratch
over several replies keeps only the version applied.

Each proposal still waiting is shown with whether it would take the document past its pages
(PageMarks), estimated against the document as it is each time the chat is read.
"""

from typing import Any

from sqlalchemy.orm import Session

from app.chat import Placed, Proposal, ProposedChange, check_change, check_open
from app.defaults import default_bullets, default_skills
from app.documents import Kind, load_tree
from app.errors import AppError, ErrorCode
from app.library import append, check_unique_name
from app.models import (
    OTHER_CATEGORY_ID,
    BulletPoint,
    ChatMessage,
    ChatRole,
    ExperienceBulletPoint,
    NarrativeContent,
    ProjectBulletPoint,
    ProjectSkill,
    SectionBulletPoint,
    SectionNarrativeContent,
    Skill,
    SkillCategorySkill,
)
from app.own_text import kept_flags
from app.page_fit import PageMark, document_fit, page_mark
from app.routers import bullet_points, narrative_content
from app.routers.bullet_points import BulletIn
from app.routers.document_tree import (
    Placed as PlacedEntry,
)
from app.routers.document_tree import (
    RestoredSection,
    apply_bullets,
    apply_skills,
    fill_section,
    restore,
)
from app.routers.narrative_content import NarrativeIn
from app.rule_proposals import RuleProposal
from app.suggestions import load_library
from app.usage import touch


def find_proposal(message: ChatMessage,
                  proposal_id: str) -> tuple[int, Proposal | RuleProposal]:
    """The proposal shown in Claude's message, by id (a change to the document, or to a rule),
    or NOT_FOUND."""
    if message.role != ChatRole.assistant:
        raise AppError(ErrorCode.NOT_FOUND)
    for index, stored in enumerate(message.proposals or []):
        if stored.get("id") == proposal_id and stored.get("state") != "left_out":
            model = RuleProposal if stored.get("kind") == "rule" else Proposal
            return index, model.model_validate(stored)
    raise AppError(ErrorCode.NOT_FOUND)


def content_key(proposal: dict[str, Any]) -> tuple[Any, ...] | None:
    """What a proposal changes: the section, or the item in its place, or a saved rule; none
    for new text or a new rule."""
    if proposal.get("kind") == "rule":
        if not proposal.get("rule_id"):
            return None
        return ("rule", proposal["target"], proposal.get("tone_set_id", 0), proposal["rule_id"])
    if proposal.get("item_id", 0) == 0 and proposal.get("target") != "section":
        return None
    return (proposal["target"], proposal["section_id"], proposal["item_id"],
            proposal["parent_kind"], proposal["parent_id"])


def place_key(proposal: dict[str, Any]) -> tuple[Any, ...]:
    """The kind of change and where it goes, for following a thread of replies: the same kind of
    content in the same section, role, or project."""
    return (proposal.get("kind", "change"), proposal.get("target"), proposal.get("section_id"),
            proposal.get("parent_kind"), proposal.get("parent_id"))


def thread_of(turns: list[ChatMessage], message: ChatMessage) -> list[tuple[ChatMessage, str]]:
    """The cards `message` answers, back up the thread: the card the user's message before it
    replied to, then the card the message before that one replied to, and so on."""
    by_id = {turn.message_id: turn for turn in turns}
    found: list[tuple[ChatMessage, str]] = []
    reply = message
    while True:
        asked = next((turn for turn in reversed(turns) if turn.role == ChatRole.user
                      and turn.message_id < reply.message_id), None)
        if asked is None or not asked.reply_to:
            return found
        earlier = by_id.get(asked.reply_to["message_id"])
        if earlier is None or earlier.message_id >= reply.message_id:
            return found
        found.append((earlier, asked.reply_to["proposal_id"]))
        reply = earlier


def mark_stale(turns: list[ChatMessage], message: ChatMessage,
               index: int) -> tuple[list[ChatMessage], int]:
    """Sets aside the pending proposals that the one at `index` in `message` replaces, in the
    conversation `turns` (in order): those for the same content that came before it, and the
    cards it answers back up the thread of replies (thread_of) that make the same kind of change
    in the same place, so a new version of new text sets its earlier versions aside. Returns the
    other messages that changed, and how many proposals went stale in all."""
    applied = message.proposals[index]
    key = content_key(applied)
    place = place_key(applied)
    answered = {(turn.message_id, proposal_id) for turn, proposal_id in thread_of(turns, message)}
    changed: list[ChatMessage] = []
    count = 0
    for turn in turns:
        if turn.role != ChatRole.assistant or turn.message_id > message.message_id:
            continue
        stale = [at for at, stored in enumerate(turn.proposals or [])
                 if (turn.message_id < message.message_id or at < index)
                 and stored.get("state") == "pending"
                 and ((key is not None and content_key(stored) == key)
                      or ((turn.message_id, stored.get("id")) in answered
                          and place_key(stored) == place))]
        if not stale:
            continue
        for at in stale:
            set_state(turn, at, "stale")
        count += len(stale)
        if turn is not message:
            changed.append(turn)
    return changed, count


def set_state(message: ChatMessage, index: int, state: str) -> None:
    # A new list, so the JSONB column sees the change.
    proposals = [dict(stored) for stored in message.proposals]
    proposals[index]["state"] = state
    message.proposals = proposals


def _at(items: list[Any], item: Any, position: int) -> None:
    """Insert counting from 1; 0 or past the end puts it last."""
    index = position - 1 if 1 <= position <= len(items) else len(items)
    items.insert(index, item)


def tree_of(sections) -> list[RestoredSection]:
    return [RestoredSection(section_id=section.section_id, entries=[
        PlacedEntry(kind=entry.kind, item_id=entry.item_id,
                    skill_ids=[child.item_id for child in entry.skills],
                    bullet_ids=[child.item_id for child in entry.bullets])
        for entry in section.entries]) for section in sections]


def _flags(change: ProposedChange) -> list[dict] | None:
    """The writing flags the chat's check found for the proposal's text, which the row it's
    saved as keeps (none when the check didn't run)."""
    return kept_flags(getattr(change, "flags", []), getattr(change, "checked", False))


def _new_text(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's new text as a new library row, listed under where it goes."""
    if change.target == "narrative":
        row = NarrativeContent(account_id=account_id, content=change.new_text,
                               flags=_flags(change))
        db.add(row)
        db.flush()
        append(db, SectionNarrativeContent, "section_id", change.section_id, "content_id",
               row.content_id)
        return row.content_id
    row = BulletPoint(account_id=account_id, content=change.new_text, flags=_flags(change))
    db.add(row)
    db.flush()
    if change.parent_kind == "experience":
        append(db, ExperienceBulletPoint, "experience_id", change.parent_id, "bullet_id",
               row.bullet_id)
    elif change.parent_kind == "project":
        append(db, ProjectBulletPoint, "project_id", change.parent_id, "bullet_id",
               row.bullet_id)
    else:
        append(db, SectionBulletPoint, "section_id", change.section_id, "bullet_id",
               row.bullet_id)
    return row.bullet_id


def _new_skill(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's new skill, saved as write_skill saves one on the page: its name must be new
    (DUPLICATE, hidden skills too), and a project's is listed under "Other", since every skill
    has a category. _list_skill lists it under its category or project."""
    check_unique_name(db, Skill.skill_name, account_id, change.new_text, "skill")
    row = Skill(account_id=account_id, skill_name=change.new_text)
    db.add(row)
    db.flush()
    if change.parent_kind == "project":
        append(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id", row.skill_id)
    return row.skill_id


def _list_skill(db: Session, change: ProposedChange, skill_id: int) -> None:
    """List the skill last under its category or project in the library, unless it's there."""
    if change.parent_kind == "category":
        append(db, SkillCategorySkill, "category_id", change.parent_id, "skill_id", skill_id)
    else:
        append(db, ProjectSkill, "project_id", change.parent_id, "skill_id", skill_id)


def _reworded(db: Session, account_id: int, change: ProposedChange) -> int:
    """Claude's wording as a new row, listed right after the original wherever it's listed."""
    if change.target == "narrative":
        original = db.get(NarrativeContent, change.item_id)
        return narrative_content.new_version(db, original, NarrativeIn(content=change.new_text),
                                             account_id, _flags(change)).content_id
    original = db.get(BulletPoint, change.item_id)
    return bullet_points.new_version(db, original, BulletIn(content=change.new_text),
                                     account_id, _flags(change)).bullet_id


def apply(db: Session, kind: Kind, account_id: int, doc: Any, change: ProposedChange) -> None:
    """Make the change to the document (see the module docstring), or VALIDATION_FAILED when
    it no longer fits the document or the library."""
    doc_id = getattr(doc, kind.doc_id)
    sections = load_tree(db, kind, doc_id)
    why = check_change(change, load_library(db, account_id), Placed(sections))
    if why:
        raise AppError(ErrorCode.VALIDATION_FAILED,
                       f"This change doesn't fit the document as it is now: {why}.")
    tree = tree_of(sections)
    action, target = change.action, change.target
    added: tuple[int, str, int] | None = None
    new_section: int | None = None

    if target == "section":
        current = next((s for s in tree if s.section_id == change.section_id), None)
        if action == "add":
            _at(tree, RestoredSection(section_id=change.section_id, entries=[]), change.position)
            new_section = change.section_id
        else:
            tree.remove(current)
            if action == "move":
                _at(tree, current, change.position)
    else:
        section = next(s for s in tree if s.section_id == change.section_id)
        if change.parent_kind:
            parent = next(entry for entry in section.entries
                          if entry.kind == change.parent_kind and entry.item_id == change.parent_id)
            children = parent.skill_ids if target == "skill" else parent.bullet_ids
            if action == "add":
                if change.item_id != 0:
                    item_id = change.item_id
                elif target == "skill":
                    item_id = _new_skill(db, account_id, change)
                else:
                    item_id = _new_text(db, account_id, change)
                if target == "skill":
                    _list_skill(db, change, item_id)
                _at(children, item_id, change.position)
            elif action == "reword":
                children[children.index(change.item_id)] = _reworded(db, account_id, change)
            else:
                children.remove(change.item_id)
                if action == "move":
                    _at(children, change.item_id, change.position)
        else:
            entries = section.entries
            if action == "add":
                item_id = (_new_text(db, account_id, change) if change.item_id == 0
                           else change.item_id)
                _at(entries, PlacedEntry(kind=target, item_id=item_id, skill_ids=[],
                                         bullet_ids=[]), change.position)
                if target in ("category", "project", "experience"):
                    added = (change.section_id, target, item_id)
            else:
                current = next(entry for entry in entries
                               if entry.kind == target and entry.item_id == change.item_id)
                if action == "reword":
                    current.item_id = _reworded(db, account_id, change)
                else:
                    entries.remove(current)
                    if action == "move":
                        _at(entries, current, change.position)

    restore(db, kind, doc_id, tree, account_id)
    if new_section is not None or added is not None:
        # What a section or item gets when it's added by hand.
        placed = {section.section_id: section for section in load_tree(db, kind, doc_id)}
        if new_section is not None:
            fill_section(db, kind, doc_id, placed[new_section].row_id, new_section, account_id)
        else:
            section_id, entry_kind, item_id = added
            section = placed[section_id]
            entry = next(e for e in section.entries
                         if e.kind == entry_kind and e.item_id == item_id)
            if entry_kind in ("category", "project"):
                apply_skills(db, kind, entry_kind, entry.row_id, item_id,
                             default_skills(db, kind, account_id, doc_id, entry_kind, item_id),
                             account_id)
            if entry_kind in ("experience", "project"):
                apply_bullets(db, kind, entry_kind, entry.row_id, section.row_id, item_id,
                              default_bullets(db, kind, account_id, doc_id, entry_kind,
                                              item_id, section.row_id), account_id)
    touch(db, kind.doc, {doc_id})


class PageMarks:
    """Marks each proposal still waiting that would take the document past its pages, or make
    a section too long for one (page_fit.page_mark), against the document as it is now. Each is
    applied for real inside a savepoint that's then rolled back, so it's estimated exactly as
    Apply would make it (an added role with its default bullets, say). One that can't be
    applied now, which Apply would refuse, isn't marked."""

    def __init__(self, db: Session, kind: Kind, account_id: int, doc: Any) -> None:
        self.db, self.kind, self.account_id, self.doc = db, kind, account_id, doc
        self.before = document_fit(db, kind, doc)

    def __call__(self, proposal: Proposal) -> PageMark | None:
        if proposal.state != "pending" or proposal.kind != "change":
            return None
        savepoint = self.db.begin_nested()
        try:
            apply(self.db, self.kind, self.account_id, self.doc, proposal)
            self.db.flush()
            after = document_fit(self.db, self.kind, self.doc)
        except AppError:
            return None
        finally:
            savepoint.rollback()
        return page_mark(self.before, after)


def gone(change: dict[str, Any], placed: Placed) -> bool:
    """Whether what a change works on is no longer in the document: its section (for anything
    but adding the section), the role, project, or skill category it goes under, or the item it
    rewords, moves, or removes."""
    section_id, target = change["section_id"], change["target"]
    if target == "section":
        return change["action"] != "add" and section_id not in placed.sections
    if section_id not in placed.sections:
        return True
    parent_kind, parent_id = change.get("parent_kind") or "", change.get("parent_id") or 0
    if parent_kind and placed.entry(section_id, parent_kind, parent_id) is None:
        return True
    if change["action"] == "add" or not change.get("item_id"):
        return False
    if parent_kind:
        return placed.child(section_id, parent_kind, parent_id, target, change["item_id"]) is None
    return placed.entry(section_id, target, change["item_id"]) is None


def set_aside_gone(db: Session, kind: Kind, doc: Any, turns: list[ChatMessage]) -> None:
    """Sets aside (`stale`) every pending change whose content was taken out of the document,
    by hand or otherwise (gone), so its card folds away like any other stale one and can be
    restored. Nothing for a chat that can't apply its proposals (a sent document, or one still
    in Claude's draft)."""
    try:
        check_open(db, kind, doc)
    except AppError:
        return
    placed = Placed(load_tree(db, kind, getattr(doc, kind.doc_id)))
    for turn in turns:
        if turn.role != ChatRole.assistant:
            continue
        for at, stored in enumerate(turn.proposals or []):
            if (stored.get("kind", "change") == "change" and stored.get("state") == "pending"
                    and gone(stored, placed)):
                set_state(turn, at, "stale")
    db.flush()


def page_marks(db: Session, kind: Kind, account_id: int, doc: Any) -> PageMarks | None:
    """The marks for a chat that can still apply its proposals: none for a sent document or
    one still in Claude's draft (chat.check_open)."""
    try:
        check_open(db, kind, doc)
    except AppError:
        return None
    return PageMarks(db, kind, account_id, doc)
