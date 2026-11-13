"""Claude's suggestion for a posting's resume or cover letter (app/suggestions.py;
docs/FRONTEND_CHECKS.md, "Claude's suggestions"), with a stand-in for Claude."""

import json
from collections.abc import Iterator
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.drafts import StartingDocument, to_draft
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    JobPosting,
    NarrativeContent,
    Resume,
    Section,
    SectionNarrativeContent,
    Skill,
    WritingRule,
    WritingRuleKind,
)
from app.suggestions import (
    LetterSection,
    LetterSuggestion,
    SuggestedBullet,
    SuggestedEntry,
    SuggestedSection,
    Suggestion,
)
from tests.test_documents import header, posting
from tests.test_education_narrative_rules import tone as tone_with
from tests.test_experience_projects_bullets import bullet, role, show_job
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, category, error, resume, show_skills, skill_id


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages(reply=Suggestion(starting_document_id=None, starting_reason="None.",
                                             sections=[]))
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


def entry(kind: str, item_id: int | None, *, new_text: str | None = None,
          skill_ids: list[int] = (), bullets: list[SuggestedBullet] = ()) -> SuggestedEntry:
    return SuggestedEntry(kind=kind, item_id=item_id, new_text=new_text, reason="Fits.",
                          skill_ids=list(skill_ids), bullets=list(bullets))


def section(section_id: int, *entries: SuggestedEntry) -> SuggestedSection:
    return SuggestedSection(section_id=section_id, reason="Fits.", entries=list(entries))


def suggested(bullet_id: int | None, new_text: str | None = None) -> SuggestedBullet:
    return SuggestedBullet(bullet_id=bullet_id, new_text=new_text, reason="Fits.")


def tailor(client: TestClient, db: Session, account_id: int, *, sent: bool = False,
           path: str = "resumes", contacts: str | None = None, **body):
    """Start a posting's resume (or cover letter) with Claude."""
    job = posting(db, account_id, sent)
    job.header_id = header(db, account_id).header_id
    job.contacts = contacts
    db.flush()
    return client.post(f"/api/{path}/tailored", json={
        "name": "Engineer at Acme", "job_posting_id": job.job_posting_id, **body})


def test_suggests_from_the_library_and_stores_the_draft(client: TestClient, db: Session,
                                                       account_id: int, claude: FakeMessages):
    job = role(db, account_id, ["Shipped it", "Tested it"], section_id=EXPERIENCE_SECTION_ID)
    shipped, tested = (bullet(db, account_id, text).bullet_id for text in ("Shipped it",
                                                                           "Tested it"))
    front_end = category(db, account_id, "Front End", ["React", "CSS"])
    earlier = resume(db, account_id, "Tech base", sent=True)
    show_job(db, earlier, job, ["Shipped it"])
    reply = Suggestion(starting_document_id=earlier.resume_id, starting_reason="Same role.",
                       sections=[section(EXPERIENCE_SECTION_ID, entry(
                           "experience", job.experience_id,
                           bullets=[suggested(tested, "Tested it in React."), suggested(shipped)])),
                                 section(SKILLS_SECTION_ID, entry("category",
                                                                  front_end.category_id))])
    claude.reply = reply

    response = tailor(client, db, account_id)
    assert response.status_code == 201, response.json()
    body = response.json()
    # It starts empty, with the suggestion in its draft and Claude's text kept once by key.
    assert body["sections"] == []
    # With no writing rules there's nothing to flag (tests/test_drafts.py checks the rules).
    assert body["draft"] == to_draft(reply, StartingDocument(
        id=earlier.resume_id, name="Tech base")).model_dump() | {"checked": True}
    assert body["draft"]["texts"] == [{
        "key": 1, "kind": "bullet", "text": "Tested it in React.", "replaces": tested,
        "section_id": EXPERIENCE_SECTION_ID, "section_key": None, "parent_kind": "experience",
        "parent_id": job.experience_id, "flags": [], "fixed": False}]
    db.expire_all()
    assert db.get(Resume, body["resume_id"]).draft == body["draft"]

    [request] = claude.calls
    assert (request["model"], request["output_config"], request["max_tokens"]) == (
        "claude-opus-5-5", {"effort": "high"}, 32000)
    assert request["output_format"] is Suggestion
    instructions, data = request["system"]
    # The library and earlier resumes come before the posting and are cached.
    assert data["cache_control"] == {"type": "ephemeral"}
    library = json.loads(data["text"].split("<library>\n")[1].split("\n</library>")[0])
    assert library["roles"][0] | {"id": job.experience_id} == {
        "id": job.experience_id, "role_title": "Engineer", "organization": "Acme",
        "location": "Remote", "dates": "2020 – 2022", "bullet_ids": [shipped, tested]}
    documents = json.loads(data["text"].split("<documents>\n")[1].split("\n</documents>")[0])
    # Only the documents with content, sent or not, and never the one being tailored.
    assert [(d["id"], d["sent"], d["made_for"]) for d in documents] == [
        (earlier.resume_id, True, "Engineer at Acme")]
    assert "resume" in instructions["text"] and "Hiring" not in instructions["text"]
    assert request["messages"][0]["content"].startswith("Tailor a new resume for this posting.")
    assert "Build things." in request["messages"][0]["content"]


def test_leaves_out_what_it_cant_use(client: TestClient, db: Session, account_id: int,
                                     claude: FakeMessages):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    unlisted = add(db, BulletPoint(account_id=account_id, content="Unlisted")).bullet_id
    hidden = add(db, BulletPoint(account_id=account_id, content="Hidden", hidden=True)).bullet_id
    theirs = add(db, NarrativeContent(account_id=add(db, Account()).account_id,
                                      content="Not mine.")).content_id
    hidden_section = add(db, Section(account_id=account_id, title="Old", hidden=True)).id
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools.")).content_id
    front_end = category(db, account_id, "Front End", ["React"])
    react = front_end.category_id
    # Listed under another category: any of the account's skills can go under one.
    category(db, account_id, "Other tools", ["Vue"], section_id=None)
    vue = skill_id(db, "Vue")
    old = add(db, Skill(account_id=account_id, skill_name="Old", hidden=True)).skill_id
    claude.reply = Suggestion(starting_document_id=999, starting_reason="?", sections=[
        section(SUMMARY_SECTION_ID,
                entry("narrative", intro, new_text=" I build tools. "),
                entry("narrative", None, new_text="I teach."),
                entry("narrative", None, new_text="  "),
                entry("narrative", theirs)),
        section(EXPERIENCE_SECTION_ID,
                entry("experience", job.experience_id, new_text="Lead Engineer",
                      bullets=[suggested(shipped), suggested(unlisted), suggested(hidden),
                               suggested(None, "Led a team.")]),
                entry("bullet", shipped),
                entry("experience", job.experience_id)),
        section(SKILLS_SECTION_ID, entry("category", react, skill_ids=[999, vue, old])),
        section(hidden_section),
        section(SUMMARY_SECTION_ID),
    ])
    body = tailor(client, db, account_id).json()["draft"]
    assert body["starting_document"] is None
    assert [s["section_id"] for s in body["sections"]] == [
        SUMMARY_SECTION_ID, EXPERIENCE_SECTION_ID, SKILLS_SECTION_ID]
    summary, experience, skills = (s["entries"] for s in body["sections"])
    texts = {text["key"]: text["text"] for text in body["texts"]}
    # The same text as the original is no rewording; empty new text and another account's
    # item are left out.
    assert [(e["item_id"], texts.get(e["text_key"])) for e in summary] == [
        (intro, None), (None, "I teach.")]
    # A role can't be reworded, bullets it doesn't list or that are hidden are left out, and
    # a bullet or role already in the section isn't placed again.
    [placed] = experience
    assert placed["text_key"] is None
    assert [(b["bullet_id"], texts.get(b["text_key"])) for b in placed["bullets"]] == [
        (shipped, None), (None, "Led a team.")]
    # Another account's skill and a hidden one are left out; one listed elsewhere stays.
    assert skills[0]["skill_ids"] == [vue]


def test_asks_again_when_it_lists_only_what_it_changed(client: TestClient, db: Session,
                                                       account_id: int, claude: FakeMessages):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    front_end = category(db, account_id, "Front End", ["React"])
    start = resume(db, account_id, "Tech base", sent=False)
    show_job(db, start, job, ["Shipped it"])
    show_skills(db, start, front_end, ["React"])
    whole = Suggestion(starting_document_id=start.resume_id, starting_reason="Same.", sections=[
        section(EXPERIENCE_SECTION_ID, entry("experience", job.experience_id)),
        section(SKILLS_SECTION_ID, entry("category", front_end.category_id))])
    # The first answer leaves out both of the starting resume's items; the second is the draft.
    answers = [whole.model_copy(update={"sections": []}), whole]
    stream = claude.stream

    def next_answer(**request):
        claude.reply = answers.pop(0)
        return stream(**request)

    claude.stream = next_answer
    response = tailor(client, db, account_id)
    assert response.status_code == 201, response.json()
    assert [s["section_id"] for s in response.json()["draft"]["sections"]] == [
        EXPERIENCE_SECTION_ID, SKILLS_SECTION_ID]
    first, again = claude.calls
    assert again["system"] == first["system"]
    assert again["messages"][0]["content"].endswith(
        "List the whole resume: every section and item, including the ones you keep as they are.")


def test_starts_from_the_one_the_user_chose(client: TestClient, db: Session,
                                           account_id: int, claude: FakeMessages):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    chosen = resume(db, account_id, "Tech base", sent=False)
    show_job(db, chosen, job, ["Shipped it"])
    other = resume(db, account_id, "Teaching base", sent=False)
    show_job(db, other, job, ["Shipped it"])
    # Claude names another, but the starting point is the one the user chose.
    claude.reply = Suggestion(starting_document_id=other.resume_id, starting_reason="Close.",
                              sections=[section(EXPERIENCE_SECTION_ID,
                                                entry("experience", job.experience_id))])
    response = tailor(client, db, account_id, start_from_id=chosen.resume_id)
    assert response.status_code == 201, response.json()
    assert response.json()["draft"]["starting_document"] == {
        "id": chosen.resume_id, "name": "Tech base"}
    [request] = claude.calls
    assert (f"Start from the resume with id {chosen.resume_id}, which the job seeker chose"
            in request["messages"][0]["content"])
    assert "Still look through the whole library" in request["messages"][0]["content"]
    # Every earlier resume is still there to take items from.
    documents = request["system"][1]["text"].split("<documents>\n")[1]
    assert f'"id": {other.resume_id}' in documents
    # The reply is the whole resume, not only what changes.
    assert "not only what you change" in request["system"][0]["text"]


def test_refuses_a_starting_point_it_cant_use(client: TestClient, db: Session, account_id: int,
                                             claude: FakeMessages):
    empty = resume(db, account_id, "Empty", sent=False)
    theirs = resume(db, add(db, Account()).account_id, "Theirs", sent=False)
    for start in (empty.resume_id, theirs.resume_id):
        response = tailor(client, db, account_id, start_from_id=start)
        assert error(response) == (422, "VALIDATION_FAILED", "start_from_id")
    assert claude.calls == []
    db.expire_all()
    assert [r.name for r in db.scalars(select(Resume))] == ["Empty", "Theirs"]


def test_refuses_a_posting_applied_to(client: TestClient, db: Session, account_id: int,
                                      claude: FakeMessages):
    assert error(tailor(client, db, account_id, sent=True)) == (
        409, "VERSION_LOCKED", "job_posting_id")
    assert claude.calls == []


def test_refuses_a_base_document_and_a_second_one(client: TestClient, db: Session,
                                                  account_id: int, claude: FakeMessages):
    base = client.post("/api/resumes/tailored", json={"name": "Tech"})
    assert error(base) == (422, "VALIDATION_FAILED", "job_posting_id")
    first = tailor(client, db, account_id)
    assert first.status_code == 201
    again = client.post("/api/resumes/tailored", json={
        "name": "Again", "job_posting_id": first.json()["job_posting"]["job_posting_id"]})
    assert error(again) == (409, "DUPLICATE", "job_posting_id")
    assert len(claude.calls) == 1


def test_claude_failing_creates_nothing(client: TestClient, db: Session, account_id: int,
                                       claude: FakeMessages):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.reply = anthropic.APIConnectionError(request=request)
    assert error(tailor(client, db, account_id))[:2] == (503, "AI_UNAVAILABLE")
    # The resume isn't created, so the user can try again.
    db.expire_all()
    assert db.scalars(select(Resume)).all() == []


def test_prompt_has_the_writing_rules_and_tone(client: TestClient, db: Session, account_id: int,
                                               claude: FakeMessages):
    for kind, text, active in ((WritingRuleKind.term, "leverage", True),
                               (WritingRuleKind.term, "synergy", False),
                               (WritingRuleKind.pattern, "em dashes used for drama", True)):
        add(db, WritingRule(account_id=account_id, kind=kind, rule_text=text, active=active))
    tone = tone_with(db, account_id, "Tech", ["Name the tools."])
    assert tailor(client, db, account_id, tone_set_id=tone.tone_set_id).status_code == 201
    [request] = claude.calls
    instructions = request["system"][0]["text"]
    assert "Never use these words or phrases: leverage." in instructions
    assert "- em dashes used for drama" in instructions
    assert "synergy" not in instructions
    assert request["messages"][0]["content"].endswith(
        "Tone for this document:\n- Name the tools.")


def test_a_cover_letter_is_tailored_as_a_letter(client: TestClient, db: Session,
                                                account_id: int, claude: FakeMessages):
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools."))
    add(db, SectionNarrativeContent(section_id=SUMMARY_SECTION_ID, content_id=intro.content_id,
                                    position=1))
    response = tailor(client, db, account_id, path="cover-letters")
    assert response.status_code == 201
    # A letter keeps its usual greeting.
    assert response.json()["addressee"] == "Acme Hiring Team"
    [request] = claude.calls
    assert "each paragraph is its own section" in request["system"][0]["text"]
    assert request["messages"][0]["content"].startswith("Tailor a new cover letter")


def letter_reply(*sections: LetterSection, addressee: str = "",
                 reason: str = "") -> LetterSuggestion:
    return LetterSuggestion(starting_document_id=None, starting_reason="None.",
                            sections=list(sections), addressee=addressee,
                            addressee_reason=reason)


def letter_section(section_id: int, new_title: str, *entries: SuggestedEntry) -> LetterSection:
    return LetterSection(section_id=section_id, new_title=new_title, reason="Fits.",
                         entries=list(entries))


def test_a_letter_gets_new_paragraphs_and_a_greeting(client: TestClient, db: Session,
                                                     account_id: int, claude: FakeMessages):
    claude.reply = letter_reply(
        # New sections, one with spacing to tidy, and one titled like a library section.
        letter_section(0, " why  Acme ", entry("narrative", None, new_text="Acme ships."),
                       entry("narrative", None, new_text="I ship too.")),
        letter_section(0, "summary", entry("narrative", None, new_text="I build tools.")),
        # The same new title twice, one too long for the database, and an empty one.
        letter_section(0, "Why acme"),
        letter_section(0, "x" * 101),
        letter_section(0, ""),
        addressee=" Jordan  Rivera ", reason="The posting names the hiring manager.")
    response = tailor(client, db, account_id, path="cover-letters",
                      contacts="Hiring manager: Jordan Rivera")
    assert response.status_code == 201, response.json()
    body = response.json()
    # The greeting waits in the draft; the letter keeps its usual one until it's approved.
    assert body["addressee"] == "Acme Hiring Team"
    draft = body["draft"]
    assert draft["greeting"] == {"addressee": "Jordan Rivera",
                                 "reason": "The posting names the hiring manager.",
                                 "use_default": False}
    assert draft["new_sections"] == [{"key": 1, "title": "why Acme"}]
    assert [(s["section_id"], s["new_key"]) for s in draft["sections"]] == [
        (None, 1), (SUMMARY_SECTION_ID, None)]
    assert [(t["text"], t["section_id"], t["section_key"]) for t in draft["texts"]] == [
        ("Acme ships.", None, 1), ("I ship too.", None, 1),
        ("I build tools.", SUMMARY_SECTION_ID, None)]

    [request] = claude.calls
    assert request["output_format"] is LetterSuggestion
    assert "one sentence per item" in request["system"][0]["text"]
    assert "Keep it rare" not in request["system"][0]["text"]
    assert "<contacts>\nHiring manager: Jordan Rivera\n</contacts>" in request["messages"][0][
        "content"]


def test_a_letter_keeps_its_usual_greeting_without_a_new_one(client: TestClient, db: Session,
                                                             account_id: int,
                                                             claude: FakeMessages):
    for addressee in ("", "acme hiring team", "x" * 101):
        claude.reply = letter_reply(addressee=addressee, reason="?")
        body = tailor(client, db, account_id, path="cover-letters").json()
        assert body["draft"]["greeting"] is None
        client.delete(f"/api/cover-letters/{body['letter_id']}")
    # No contacts, no <contacts>.
    assert "<contacts>" not in claude.calls[0]["messages"][0]["content"]


def test_a_resume_has_no_new_sections(client: TestClient, db: Session, account_id: int,
                                      claude: FakeMessages):
    # A resume's reply has no titles, so a section id of 0 isn't a library section.
    claude.reply = Suggestion(starting_document_id=None, starting_reason="None.", sections=[
        section(0, entry("narrative", None, new_text="I build tools."))])
    draft = tailor(client, db, account_id).json()["draft"]
    assert (draft["sections"], draft["new_sections"], draft["greeting"]) == ([], [], None)


def test_applying_waits_until_the_draft_is_reviewed(client: TestClient, db: Session,
                                                    account_id: int, claude: FakeMessages):
    draft = tailor(client, db, account_id).json()
    tracking = f"/api/job-postings/{draft['job_posting']['job_posting_id']}/tracking"
    response = client.put(tracking, json={"applied_on": "2026-11-04"})
    assert error(response) == (422, "VALIDATION_FAILED", "applied_on")
    assert "Approve the first draft of the resume first." in response.json()["error"][
        "message"]
    # Other tracking still saves.
    assert client.put(tracking, json={"contacts": "Jamie Lee"}).status_code == 200
    db.expire_all()
    db.get(Resume, draft["resume_id"]).draft = None
    db.flush()
    final = client.put(tracking, json={"applied_on": "2026-11-04"})
    assert final.status_code == 200, final.json()


def test_a_letter_reads_the_postings_resume(client: TestClient, db: Session, account_id: int,
                                           claude: FakeMessages):
    """A posting's cover letter is tailored with its resume in view, as plain text, and the
    other way around; without one there's nothing to read."""
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    doc = resume(db, account_id, "Engineer at Acme", sent=False)
    show_job(db, doc, job, ["Shipped it"])
    job_posting = db.get(JobPosting, doc.job_posting_id)
    job_posting.header_id = header(db, account_id).header_id
    db.flush()
    claude.reply = LetterSuggestion(starting_document_id=None, starting_reason="", sections=[],
                                    addressee="", addressee_reason="")
    response = client.post("/api/cover-letters/tailored", json={
        "name": "Engineer at Acme", "job_posting_id": doc.job_posting_id})
    assert response.status_code == 201, response.json()
    request = claude.calls[0]
    content = request["messages"][0]["content"]
    assert "<resume_for_this_posting>\nExperience\n" in content
    assert "- Shipped it\n</resume_for_this_posting>" in content
    assert "without repeating the resume's bullets" in request["system"][0]["text"]
    # Another posting's resume has no cover letter to read.
    claude.reply = Suggestion(starting_document_id=None, starting_reason="", sections=[])
    tailor(client, db, account_id)
    assert "_for_this_posting>" not in claude.calls[1]["messages"][0]["content"]
