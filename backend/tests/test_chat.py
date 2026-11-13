"""The chat with Claude beside a resume or cover letter (app/chat.py; docs/FRONTEND_CHECKS.md,
"Chat with Claude"), with a stand-in for Claude that streams."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from anthropic.types.beta import BetaTextBlock, BetaThinkingBlock, BetaToolUseBlock
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.chat import PROPOSE_TOOL, Placed, ProposedChange, check_change
from app.claude import get_client
from app.documents import RESUME, load_tree
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    ChatMessage,
    CoverLetter,
    NarrativeContent,
    Resume,
    ResumeBulletPoint,
)
from app.suggestions import load_library
from tests.test_experience_projects_bullets import bullet, role, show_job
from tests.test_sections_skills import add, category, error, resume


class FakeChat:
    """Answers like client.beta.messages.stream for the chat: streams each reply's text, then
    gives the whole message, with a thinking block and any tool calls."""

    def __init__(self) -> None:
        self.replies: list[Any] = []
        self.calls: list[dict[str, Any]] = []

    def answer(self, *texts: str, tools: list[dict[str, Any]] = (),
               stop_reason: str | None = None) -> None:
        self.replies.append((texts, list(tools), stop_reason or (
            "tool_use" if tools else "end_turn")))

    @contextmanager
    def stream(self, **request: Any) -> Iterator[SimpleNamespace]:
        # The history is a list the next turn appends to, so keep a copy of this one.
        self.calls.append(json.loads(json.dumps(request, default=str)))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        texts, tools, stop_reason = reply
        content = [BetaThinkingBlock(type="thinking", thinking="", signature="sig"),
                   *(BetaTextBlock(type="text", text=text) for text in texts),
                   *(BetaToolUseBlock(type="tool_use", id=f"toolu_{n}", name="propose_change",
                                      input=tool) for n, tool in enumerate(tools, start=1))]
        message = SimpleNamespace(content=content, stop_reason=stop_reason,
                                  usage={"input_tokens": 1, "output_tokens": 1})
        events = [SimpleNamespace(type="thinking"),
                  *(SimpleNamespace(type="text", text=text) for text in texts)]
        yield SimpleNamespace(__iter__=None, get_final_message=lambda: message,
                              events=events)


class Stream(SimpleNamespace):
    def __iter__(self):
        return iter(self.events)


@pytest.fixture
def claude(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeChat]:
    chat = FakeChat()
    original = chat.stream

    @contextmanager
    def stream(**request: Any):
        with original(**request) as made:
            yield Stream(events=made.events, get_final_message=made.get_final_message)

    monkeypatch.setattr(chat, "stream", stream)
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=chat))
    yield chat


def change(action: str, target: str, section_id: int, item_id: int = 0, *,
           parent_kind: str = "", parent_id: int = 0, new_text: str = "",
           position: int = 0) -> dict[str, Any]:
    return ProposedChange(action=action, target=target, section_id=section_id,
                          item_id=item_id, parent_kind=parent_kind, parent_id=parent_id,
                          new_text=new_text, position=position, reason="Fits.").model_dump()


def setup_resume(db: Session, account_id: int, *, sent: bool = False):
    """A resume with a role and two of its three bullets in Experience."""
    job = role(db, account_id, ["Shipped it", "Tested it", "Led a team"],
               section_id=EXPERIENCE_SECTION_ID)
    doc = resume(db, account_id, "Tech", sent=sent)
    show_job(db, doc, job, ["Shipped it", "Tested it"])
    ids = {"job": job.experience_id, **{text: bullet(db, account_id, text).bullet_id
                                        for text in ("Shipped it", "Tested it", "Led a team")}}
    return doc, ids


def send(client: TestClient, doc: Resume, text: str = "Tighten the first bullet.",
         about: dict[str, Any] | None = None):
    return client.post(f"/api/resumes/{doc.resume_id}/chat",
                       json={"text": text, **({"about": about} if about else {})})


def lines(response) -> list[dict[str, Any]]:
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_streams_the_reply_and_saves_both_turns(client: TestClient, db: Session,
                                                account_id: int, claude: FakeChat):
    doc, ids = setup_resume(db, account_id)
    unlisted = add(db, BulletPoint(account_id=account_id, content="Unlisted")).bullet_id
    claude.answer("Here's a tighter ", "version.", tools=[
        change("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"],
               parent_kind="experience", parent_id=ids["job"], new_text=" Shipped it weekly. "),
        # Not listed under the role, so it isn't shown.
        change("add", "bullet", EXPERIENCE_SECTION_ID, unlisted, parent_kind="experience",
               parent_id=ids["job"])])
    response = send(client, doc, "  Tighten the first bullet.  ", about={
        "level": "item", "section_id": EXPERIENCE_SECTION_ID, "kind": "bullet",
        "item_id": ids["Shipped it"], "parent_kind": "experience", "parent_id": ids["job"]})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    streamed = lines(response)
    assert [line["text"] for line in streamed if line["type"] == "text"] == [
        "Here's a tighter ", "version."]
    done = streamed[-1]
    assert done["type"] == "done"
    asked, answered = done["messages"]
    assert (asked["role"], asked["text"], asked["about"]["kind"]) == (
        "user", "Tighten the first bullet.", "bullet")
    assert (answered["role"], answered["text"]) == ("assistant", "Here's a tighter version.")
    [proposal] = answered["proposals"]
    assert (proposal["id"], proposal["new_text"], proposal["before"], proposal["state"]) == (
        "toolu_1", "Shipped it weekly.", "Shipped it", "pending")
    # Saved, and read back the same way.
    assert client.get(f"/api/resumes/{doc.resume_id}/chat").json() == done["messages"]

    [request] = claude.calls
    assert (request["model"], request["output_config"], request["tools"]) == (
        "claude-opus-5-5", {"effort": "medium"}, [json.loads(json.dumps(PROPOSE_TOOL))])
    instructions, library, posting = request["system"]
    assert "propose_change" in instructions["text"] and "Never say a change is made" in \
        instructions["text"]
    assert library["cache_control"] == posting["cache_control"] == {"type": "ephemeral"}
    assert "<posting>\nOrganization: Acme" in posting["text"]
    [turn] = request["messages"]
    document, about, text = turn["content"]
    assert document["text"].startswith("<document>")
    assert json.loads(document["text"].split("\n")[1])[0]["entries"][0]["bullets"] == [
        {"id": ids["Shipped it"], "text": "Shipped it"},
        {"id": ids["Tested it"], "text": "Tested it"}]
    assert about["text"] == (f'<about>bullet {ids["Shipped it"]} under experience '
                             f'{ids["job"]} in section "Experience" (id 3)</about>')
    # Only the newest block is marked, so the history before it is read from the cache.
    assert text == {"type": "text", "text": "Tighten the first bullet.",
                    "cache_control": {"type": "ephemeral"}}


def test_the_next_message_replays_the_history_and_says_what_became_of_each_proposal(
        client: TestClient, db: Session, account_id: int, claude: FakeChat):
    doc, ids = setup_resume(db, account_id)
    claude.answer("Try this.", tools=[
        change("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"],
               parent_kind="experience", parent_id=ids["job"], new_text="Shipped it weekly."),
        change("reword", "experience", EXPERIENCE_SECTION_ID, ids["job"], new_text="?")])
    send(client, doc)
    db.expire_all()
    answered = db.scalars(select(ChatMessage).where(ChatMessage.role == "assistant")).one()
    answered.proposals = [{**answered.proposals[0], "state": "applied"},
                          *answered.proposals[1:]]
    db.flush()

    claude.answer("Glad it helped.")
    send(client, doc, "Thanks.")
    first, second = claude.calls
    asked, replied, now = second["messages"]
    # The earlier turns go back exactly as they were, Claude's thinking included.
    first_turn = first["messages"][0]["content"]
    first_turn[-1].pop("cache_control")
    assert asked == {"role": "user", "content": first_turn}
    assert replied["role"] == "assistant" and replied["content"][0] == {
        "type": "thinking", "thinking": "", "signature": "sig"}
    applied, left_out, about, text = now["content"]
    assert applied == {"type": "tool_result", "tool_use_id": "toolu_1",
                       "content": "The person applied it."}
    assert left_out == {"type": "tool_result", "tool_use_id": "toolu_2", "is_error": True,
                        "content": "Not shown to the person: only narrative content and "
                                   "bullets can be reworded."}
    # The document hasn't changed since Claude saw it, so it isn't sent again.
    assert about["text"] == "<about>the whole resume</about>"
    assert text["text"] == "Thanks."

    # Once it changes, the next message sends it again.
    db.execute(ResumeBulletPoint.__table__.delete().where(
        ResumeBulletPoint.bullet_id == ids["Tested it"]))
    claude.answer("Noted.")
    send(client, doc, "I removed one.")
    assert claude.calls[2]["messages"][-1]["content"][0]["text"].startswith("<document>")
    # A turn with no tool calls has no results to open the next one.
    claude.answer("Sure.")
    send(client, doc, "And now?")
    assert claude.calls[3]["messages"][-1]["content"][0]["text"] == (
        "<about>the whole resume</about>")
    # The library in the system prompt changes during a conversation, so saved thinking
    # blocks that no longer match are dropped rather than refusing the message.
    assert claude.calls[3]["thinking"] == {
        "type": "adaptive", "block_binding": {"prefix_mismatch_behavior": "drop_block"}}
    assert "thinking-binding-controls-2026-08-01" in claude.calls[3]["betas"]


def test_refuses_a_message_it_cant_send(client: TestClient, db: Session, account_id: int,
                                        claude: FakeChat):
    doc, ids = setup_resume(db, account_id)
    assert error(send(client, doc, "   ")) == (422, "VALIDATION_FAILED", "text")
    assert error(send(client, doc, "x" * 4001)) == (422, "VALIDATION_FAILED", "text")
    for about in ({"level": "section", "section_id": SKILLS_SECTION_ID},
                  {"level": "item", "section_id": EXPERIENCE_SECTION_ID, "kind": "bullet",
                   "item_id": ids["Led a team"], "parent_kind": "experience",
                   "parent_id": ids["job"]},
                  {"level": "item", "section_id": EXPERIENCE_SECTION_ID, "kind": "skill",
                   "item_id": 1}):
        assert error(send(client, doc, about=about)) == (422, "VALIDATION_FAILED", "about")
    doc.draft = {"sections": []}
    db.flush()
    assert error(send(client, doc))[:2] == (422, "VALIDATION_FAILED")
    doc.draft = None
    db.flush()
    sent, _ = setup_resume(db, account_id, sent=True)
    assert error(send(client, sent))[:2] == (409, "VERSION_LOCKED")
    # A sent one's chat can still be read.
    assert client.get(f"/api/resumes/{sent.resume_id}/chat").json() == []
    assert error(client.get("/api/resumes/999999/chat"))[:2] == (404, "NOT_FOUND")
    assert claude.calls == []


@pytest.mark.parametrize("failure", ["error", "max_tokens"])
def test_claude_failing_saves_nothing(client: TestClient, db: Session, account_id: int,
                                      claude: FakeChat, failure: str,
                                      caplog: pytest.LogCaptureFixture):
    doc, _ = setup_resume(db, account_id)
    if failure == "error":
        claude.replies.append(anthropic.APIConnectionError(
            request=httpx.Request("POST", "https://api.anthropic.com")))
    else:
        claude.answer("Cut off", stop_reason="max_tokens")
    response = send(client, doc)
    assert response.status_code == 200
    *_, last = lines(response)
    assert last == {"type": "error", "error": {
        "code": "AI_UNAVAILABLE", "message": last["error"]["message"], "field": None}}
    # The cause is logged, since the stream only says Claude isn't available.
    [record] = [record for record in caplog.records if "in the chat" in record.getMessage()]
    assert record.levelname == "ERROR" and record.exc_info is not None
    db.expire_all()
    assert db.scalars(select(ChatMessage)).all() == []


def test_an_item_dialogs_unsaved_text_goes_with_the_message(client: TestClient, db: Session,
                                                           account_id: int, claude: FakeChat):
    doc, ids = setup_resume(db, account_id)
    claude.answer("Looks good.")
    send(client, doc, about={"level": "item", "section_id": EXPERIENCE_SECTION_ID,
                             "kind": "experience", "item_id": ids["job"],
                             "unsaved": {"role_title": "Senior Engineer"}})
    about = claude.calls[0]["messages"][0]["content"][1]["text"]
    assert about == (f'<about>experience {ids["job"]} in section "Experience" (id 3)</about>\n'
                     '<unsaved>The person is editing it, with these values not saved yet: '
                     '{"role_title": "Senior Engineer"}</unsaved>')


def test_checks_each_kind_of_proposal(db: Session, account_id: int):
    doc, ids = setup_resume(db, account_id)
    front = category(db, account_id, "Front End", ["React"], section_id=SKILLS_SECTION_ID)
    library = load_library(db, account_id)
    placed = Placed(load_tree(db, RESUME, doc.resume_id))
    job = {"parent_kind": "experience", "parent_id": ids["job"]}

    def why(*args, **kwargs) -> str | None:
        return check_change(ProposedChange.model_validate(change(*args, **kwargs)), library,
                            placed)

    # What can be shown.
    assert why("add", "bullet", EXPERIENCE_SECTION_ID, ids["Led a team"], **job) is None
    assert why("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="Mentored two.", **job) is None
    assert why("move", "bullet", EXPERIENCE_SECTION_ID, ids["Tested it"], position=1,
               **job) is None
    assert why("remove", "experience", EXPERIENCE_SECTION_ID, ids["job"]) is None
    assert why("add", "section", SKILLS_SECTION_ID) is None
    assert why("move", "section", EXPERIENCE_SECTION_ID, position=1) is None
    assert why("add", "category", EXPERIENCE_SECTION_ID, front.category_id) is None
    # What can't.
    assert why("add", "section", EXPERIENCE_SECTION_ID) == "section 3 is already in the document"
    assert why("remove", "section", SUMMARY_SECTION_ID) == "section 1 isn't in the document"
    assert why("add", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"], **job) == (
        f"bullet {ids['Shipped it']} is already there")
    assert why("remove", "bullet", EXPERIENCE_SECTION_ID, ids["Led a team"], **job) == (
        f"bullet {ids['Led a team']} isn't in the document there")
    assert why("add", "skill", EXPERIENCE_SECTION_ID, 1) == (
        "a skill goes under a skill category or project")
    assert why("add", "skill", EXPERIENCE_SECTION_ID, 1, **job) == (
        "a skill can't go under a experience")
    assert why("add", "experience", EXPERIENCE_SECTION_ID, 0, new_text="New role") == (
        "only new narrative content, a new bullet, or a new skill can have item_id 0, with its "
        "text")
    assert why("add", "skill", EXPERIENCE_SECTION_ID, 0, **job) == (
        "only new narrative content, a new bullet, or a new skill can have item_id 0, with its "
        "text")
    assert why("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"], new_text="Shipped it",
               **job) == "the new wording is the same as the original"
    assert why("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"], **job) == (
        "a rewording needs its new wording")
    assert why("add", "category", SKILLS_SECTION_ID, front.category_id) == (
        "section 2 isn't in the document")


def test_sends_the_postings_other_document_when_it_changed(client: TestClient, db: Session,
                                                          account_id: int, claude: FakeChat):
    """A posting's resume chat reads its cover letter (and the other way around), as plain
    text, in a message only when it changed since Claude last saw it."""
    doc, _ = setup_resume(db, account_id)
    letter = add(db, CoverLetter(account_id=account_id, name="Letter",
                                 job_posting_id=doc.job_posting_id))
    sentence = add(db, NarrativeContent(account_id=account_id, content="I like your tools."))

    def letter_says(*content_ids: int) -> None:
        response = client.put(f"/api/cover-letters/{letter.letter_id}/tree", json={"sections": [
            {"section_id": SUMMARY_SECTION_ID, "entries": [
                {"kind": "narrative", "item_id": content_id, "skill_ids": [], "bullet_ids": []}
                for content_id in content_ids]}]})
        assert response.status_code == 200, response.json()

    def others(call: dict[str, Any]) -> list[str]:
        return [block["text"] for block in call["messages"][-1]["content"]
                if block.get("text", "").startswith("<cover_letter_for_this_posting>")]

    # An empty letter isn't sent.
    claude.answer("Fine.")
    send(client, doc)
    assert others(claude.calls[0]) == []
    assert "<cover_letter_for_this_posting>" in claude.calls[0]["system"][0]["text"]
    letter_says(sentence.content_id)
    claude.answer("Fine.")
    claude.answer("Fine.")
    send(client, doc)
    send(client, doc)
    assert others(claude.calls[1]) == [
        "<cover_letter_for_this_posting>\nI like your tools.\n</cover_letter_for_this_posting>"]
    # Unchanged, so not sent again.
    assert others(claude.calls[2]) == []
