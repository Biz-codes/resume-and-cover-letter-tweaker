"""Applying and dismissing Claude's proposals from the chat (app/proposals.py;
docs/FRONTEND_CHECKS.md, "Chat with Claude")."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import page_fit
from app.chat import Proposal
from app.models import (
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    PROJECTS_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    BulletPoint,
    ChatMessage,
    ChatRole,
    ExperienceBulletPoint,
    NarrativeContent,
    Project,
    ProjectSkill,
    ResumeBulletPoint,
    SectionNarrativeContent,
    SectionProject,
    Skill,
    SkillCategorySkill,
)
from tests.test_chat import change, setup_resume
from tests.test_experience_projects_bullets import listed, role
from tests.test_sections_skills import add, category, error, skill_id


def proposed(db: Session, account_id: int, doc, *changes: dict[str, Any]) -> ChatMessage:
    """Claude's turn in the chat with these proposals, as the chat would save it."""
    add(db, ChatMessage(account_id=account_id, resume_id=doc.resume_id, role=ChatRole.user,
                        text="Help.", about={"level": "document"}, content=[]))
    return add(db, ChatMessage(
        account_id=account_id, resume_id=doc.resume_id, role=ChatRole.assistant, text="Try this.",
        content=[], proposals=[Proposal(id=f"toolu_{n}", **proposal).model_dump()
                               for n, proposal in enumerate(changes, start=1)]))


def url(doc, message: ChatMessage, proposal: str = "toolu_1") -> str:
    return f"/api/resumes/{doc.resume_id}/chat/{message.message_id}/proposals/{proposal}"


def apply(client: TestClient, doc, message: ChatMessage, proposal: str = "toolu_1"):
    return client.post(f"{url(doc, message, proposal)}/apply")


def bullets_shown(body: dict[str, Any]) -> list[str]:
    [section] = [s for s in body["sections"] if s["section_id"] == EXPERIENCE_SECTION_ID]
    return [bullet["text"] for bullet in section["entries"][0]["bullets"]]


def test_applying_a_rewording_saves_a_new_row_used_here_only(client: TestClient, db: Session,
                                                             account_id: int):
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    message = proposed(db, account_id, doc, change(
        "reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"], new_text="Shipped weekly.",
        **job))
    response = apply(client, doc, message)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert bullets_shown(body["document"]) == ["Shipped weekly.", "Tested it"]
    assert body["message"]["proposals"][0]["state"] == "applied"
    db.expire_all()
    new = db.scalar(select(BulletPoint.bullet_id).where(BulletPoint.content == "Shipped weekly."))
    # Listed right after the original, which is unchanged.
    assert listed(db, ExperienceBulletPoint, "experience_id", ids["job"], "bullet_id") == [
        ids["Shipped it"], new, ids["Tested it"], ids["Led a team"]]
    assert db.get(BulletPoint, ids["Shipped it"]).content == "Shipped it"
    # Applied once only.
    assert error(apply(client, doc, message)) == (422, "VALIDATION_FAILED", None)


def test_applying_adds_moves_and_removes(client: TestClient, db: Session, account_id: int):
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    message = proposed(
        db, account_id, doc,
        change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="Mentored two.", position=1,
               **job),
        change("add", "bullet", EXPERIENCE_SECTION_ID, ids["Led a team"], **job),
        change("move", "bullet", EXPERIENCE_SECTION_ID, ids["Tested it"], position=1, **job),
        change("remove", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"], **job))
    shown = []
    for proposal in ("toolu_1", "toolu_2", "toolu_3", "toolu_4"):
        response = apply(client, doc, message, proposal)
        assert response.status_code == 200, response.json()
        shown.append(bullets_shown(response.json()["document"]))
        db.expire_all()
    assert shown == [
        ["Mentored two.", "Shipped it", "Tested it"],
        ["Mentored two.", "Shipped it", "Tested it", "Led a team"],
        ["Tested it", "Mentored two.", "Shipped it", "Led a team"],
        ["Tested it", "Mentored two.", "Led a team"]]
    # New text is listed under the role it was written for.
    new = db.scalar(select(BulletPoint.bullet_id).where(BulletPoint.content == "Mentored two."))
    assert new in listed(db, ExperienceBulletPoint, "experience_id", ids["job"], "bullet_id")


def test_an_added_section_or_role_gets_its_usual_defaults(client: TestClient, db: Session,
                                                          account_id: int):
    doc, ids = setup_resume(db, account_id)
    intro = add(db, NarrativeContent(account_id=account_id, content="I build tools."))
    add(db, SectionNarrativeContent(section_id=SUMMARY_SECTION_ID, content_id=intro.content_id,
                                    position=1))
    other = role(db, account_id, ["Taught it"], section_id=EXPERIENCE_SECTION_ID,
                 organization="Beta")
    message = proposed(db, account_id, doc,
                       change("add", "section", SUMMARY_SECTION_ID, position=1),
                       change("add", "experience", EXPERIENCE_SECTION_ID, other.experience_id))
    body = apply(client, doc, message).json()["document"]
    summary = body["sections"][0]
    assert (summary["section_id"], [e["values"]["content"] for e in summary["entries"]]) == (
        SUMMARY_SECTION_ID, ["I build tools."])
    db.expire_all()
    body = apply(client, doc, message, "toolu_2").json()["document"]
    [experience] = [s for s in body["sections"] if s["section_id"] == EXPERIENCE_SECTION_ID]
    beta = experience["entries"][1]
    assert (beta["item_id"], [b["text"] for b in beta["bullets"]]) == (
        other.experience_id, ["Taught it"])


def test_a_change_that_no_longer_fits_is_refused(client: TestClient, db: Session,
                                                 account_id: int):
    doc, ids = setup_resume(db, account_id)
    message = proposed(db, account_id, doc, change(
        "reword", "bullet", EXPERIENCE_SECTION_ID, ids["Tested it"], new_text="Tested well.",
        parent_kind="experience", parent_id=ids["job"]))
    db.execute(ResumeBulletPoint.__table__.delete().where(
        ResumeBulletPoint.bullet_id == ids["Tested it"]))
    response = apply(client, doc, message)
    assert error(response) == (422, "VALIDATION_FAILED", None)
    assert "doesn't fit the document as it is now" in response.json()["error"]["message"]
    db.expire_all()
    assert db.scalar(select(BulletPoint).where(BulletPoint.content == "Tested well.")) is None
    assert db.get(ChatMessage, message.message_id).proposals[0]["state"] == "pending"


def test_dismissing_and_taking_it_back(client: TestClient, db: Session, account_id: int):
    doc, ids = setup_resume(db, account_id)
    message = proposed(db, account_id, doc,
                       change("remove", "experience", EXPERIENCE_SECTION_ID, ids["job"]))
    response = client.put(url(doc, message), json={"state": "dismissed"})
    assert response.json()["proposals"][0]["state"] == "dismissed"
    # Dismissed, it can't be applied until it's taken back.
    assert error(apply(client, doc, message))[:2] == (422, "VALIDATION_FAILED")
    assert client.put(url(doc, message), json={"state": "pending"}).json()["proposals"][0][
        "state"] == "pending"
    assert apply(client, doc, message).status_code == 200
    db.expire_all()
    # An applied one stays applied; Undo on the page takes the change back.
    assert error(client.put(url(doc, message), json={"state": "dismissed"}))[:2] == (
        422, "VALIDATION_FAILED")


def test_applying_sets_aside_earlier_proposals_for_the_same_content(
        client: TestClient, db: Session, account_id: int):
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    shipped = ids["Shipped it"]

    def reword(text: str):
        return change("reword", "bullet", EXPERIENCE_SECTION_ID, shipped, new_text=text, **job)

    first = proposed(db, account_id, doc,
                     reword("Shipped weekly."),
                     # Another bullet, and new text: not the same content.
                     change("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Tested it"],
                            new_text="Tested well.", **job),
                     change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="Led five.",
                            **job),
                     # Dismissed already: it stays dismissed.
                     change("remove", "bullet", EXPERIENCE_SECTION_ID, shipped, **job))
    client.put(url(doc, first, "toolu_4"), json={"state": "dismissed"})
    later = proposed(db, account_id, doc,
                     change("move", "bullet", EXPERIENCE_SECTION_ID, shipped, position=2, **job),
                     reword("Shipped it every week."),
                     change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="Led six.",
                            **job),
                     # After the one applied, in the same reply: not earlier, so it stays.
                     reword("Shipped it often."))
    db.expire_all()

    response = apply(client, doc, later, "toolu_2")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert [p["state"] for p in body["message"]["proposals"]] == [
        "stale", "applied", "pending", "pending"]
    [updated] = body["updated"]
    assert updated["message_id"] == first.message_id
    assert [p["state"] for p in updated["proposals"]] == [
        "stale", "pending", "pending", "dismissed"]
    assert body["stale"] == 2
    # Saved, and Claude is told in the next message.
    db.expire_all()
    assert db.get(ChatMessage, first.message_id).proposals[0]["state"] == "stale"
    # A stale one can't be applied or dismissed, but it can be restored, then applied.
    assert error(apply(client, doc, first))[:2] == (422, "VALIDATION_FAILED")
    assert error(client.put(url(doc, first), json={"state": "dismissed"}))[:2] == (
        422, "VALIDATION_FAILED")
    assert client.put(url(doc, first), json={"state": "pending"}).json()["proposals"][0][
        "state"] == "pending"

    # Applying an earlier one never sets aside a later one.
    early = proposed(db, account_id, doc, change(
        "move", "experience", EXPERIENCE_SECTION_ID, ids["job"], position=1))
    proposed(db, account_id, doc, change(
        "remove", "experience", EXPERIENCE_SECTION_ID, ids["job"]))
    body = apply(client, doc, early).json()
    assert (body["updated"], body["stale"]) == ([], 0)


def test_new_text_never_sets_others_aside(client: TestClient, db: Session, account_id: int):
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    message = proposed(db, account_id, doc,
                       change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="A.", **job),
                       change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="B.", **job))
    body = apply(client, doc, message, "toolu_2").json()
    assert [p["state"] for p in body["message"]["proposals"]] == ["pending", "applied"]
    assert body["stale"] == 0


def test_applying_a_reply_sets_aside_the_cards_it_answers(client: TestClient, db: Session,
                                                          account_id: int):
    # New text written over a thread of replies, as a summary from scratch is: each reply's
    # card is a new version of the one replied to.
    doc, ids = setup_resume(db, account_id)

    def draft(text: str):
        # In Experience, the section the test resume has; any content goes in any section.
        return change("add", "narrative", EXPERIENCE_SECTION_ID, 0, new_text=text)

    def reply_to(message: ChatMessage, proposal: str = "toolu_1"):
        add(db, ChatMessage(account_id=account_id, resume_id=doc.resume_id, role=ChatRole.user,
                            text="Shorter.", about={"level": "document"}, content=[],
                            reply_to={"message_id": message.message_id, "proposal_id": proposal,
                                      "label": "Add new text in Summary", "text": ""}))
        return add(db, ChatMessage(
            account_id=account_id, resume_id=doc.resume_id, role=ChatRole.assistant,
            text="Here.", content=[], proposals=[Proposal(id="toolu_1", **draft("C.")).model_dump(),
                                                 Proposal(id="toolu_2", **change(
                                                     "add", "bullet", EXPERIENCE_SECTION_ID, 0,
                                                     new_text="D.", parent_kind="experience",
                                                     parent_id=ids["job"])).model_dump()]))

    first = proposed(db, account_id, doc, draft("A."))
    unrelated = proposed(db, account_id, doc, draft("Another paragraph."))
    second = reply_to(first)
    third = reply_to(second)
    response = apply(client, doc, third)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["stale"] == 2
    # Read again: the request changed them in its own session.
    for message in (first, second, unrelated):
        db.refresh(message)
    assert [first.proposals[0]["state"], second.proposals[0]["state"]] == ["stale", "stale"]
    # Outside the thread, or another kind of change in it, is left alone.
    assert unrelated.proposals[0]["state"] == "pending"
    assert second.proposals[1]["state"] == "pending"
    assert [p["state"] for p in body["message"]["proposals"]] == ["applied", "pending"]


def test_refuses_what_isnt_there_or_cant_change(client: TestClient, db: Session,
                                                account_id: int):
    doc, ids = setup_resume(db, account_id)
    message = proposed(db, account_id, doc,
                       change("remove", "experience", EXPERIENCE_SECTION_ID, ids["job"]))
    asked = db.scalars(select(ChatMessage).where(ChatMessage.role == ChatRole.user)).one()
    assert error(apply(client, doc, message, "toolu_9"))[:2] == (404, "NOT_FOUND")
    assert error(client.post(f"/api/resumes/{doc.resume_id}/chat/{asked.message_id}"
                             "/proposals/toolu_1/apply"))[:2] == (404, "NOT_FOUND")
    other, _ = setup_resume(db, account_id)
    assert error(client.post(f"/api/resumes/{other.resume_id}/chat/{message.message_id}"
                             "/proposals/toolu_1/apply"))[:2] == (404, "NOT_FOUND")
    sent, sent_ids = setup_resume(db, account_id, sent=True)
    locked = proposed(db, account_id, sent,
                      change("remove", "experience", EXPERIENCE_SECTION_ID, sent_ids["job"]))
    assert error(apply(client, sent, locked))[:2] == (409, "VERSION_LOCKED")
    assert error(client.put(url(sent, locked), json={"state": "dismissed"}))[:2] == (
        409, "VERSION_LOCKED")


def test_any_skill_or_a_new_one_goes_under_a_category_or_project(client: TestClient, db: Session,
                                                                 account_id: int):
    """As on the page: any of the account's skills can be shown under a category or project, and
    is listed under it in the library too; a new skill is saved the way the page saves one."""
    doc, ids = setup_resume(db, account_id)
    back = category(db, account_id, "Back End", ["Python"])
    category(db, account_id, "Tools", ["Alembic"], section_id=None)
    tweaker = add(db, Project(account_id=account_id, project_title="Tweaker"))
    add(db, SectionProject(section_id=PROJECTS_SECTION_ID, project_id=tweaker.project_id,
                           position=1))
    python, alembic = skill_id(db, "Python"), skill_id(db, "Alembic")
    placed = client.put(f"/api/resumes/{doc.resume_id}/tree", json={"sections": [
        {"section_id": EXPERIENCE_SECTION_ID, "entries": [
            {"kind": "experience", "item_id": ids["job"], "skill_ids": [],
             "bullet_ids": [ids["Shipped it"], ids["Tested it"]]}]},
        {"section_id": SKILLS_SECTION_ID, "entries": [
            {"kind": "category", "item_id": back.category_id, "skill_ids": [python],
             "bullet_ids": []}]},
        {"section_id": PROJECTS_SECTION_ID, "entries": [
            {"kind": "project", "item_id": tweaker.project_id, "skill_ids": [],
             "bullet_ids": []}]}]})
    assert placed.status_code == 200, placed.json()
    under_back = {"parent_kind": "category", "parent_id": back.category_id}
    under_tweaker = {"parent_kind": "project", "parent_id": tweaker.project_id}
    message = proposed(
        db, account_id, doc,
        # Alembic is listed under Tools, not Back End.
        change("add", "skill", SKILLS_SECTION_ID, alembic, **under_back),
        change("add", "skill", SKILLS_SECTION_ID, 0, new_text="SQLAlchemy", **under_back),
        change("add", "skill", PROJECTS_SECTION_ID, 0, new_text="Vite", **under_tweaker),
        change("add", "skill", PROJECTS_SECTION_ID, 0, new_text="python", **under_tweaker),
        change("add", "skill", PROJECTS_SECTION_ID, 0, new_text="x" * 101, **under_tweaker))
    for proposal in ("toolu_1", "toolu_2", "toolu_3"):
        response = apply(client, doc, message, proposal)
        assert response.status_code == 200, response.json()
        db.expire_all()
    document = response.json()["document"]
    sections = {section["section_id"]: section for section in document["sections"]}
    assert [skill["text"] for skill in sections[SKILLS_SECTION_ID]["entries"][0]["skills"]] == [
        "Python", "Alembic", "SQLAlchemy"]
    assert [skill["text"] for skill in sections[PROJECTS_SECTION_ID]["entries"][0]["skills"]] == [
        "Vite"]
    sqlalchemy, vite = skill_id(db, "SQLAlchemy"), skill_id(db, "Vite")
    assert listed(db, SkillCategorySkill, "category_id", back.category_id, "skill_id") == [
        python, alembic, sqlalchemy]
    assert listed(db, ProjectSkill, "project_id", tweaker.project_id, "skill_id") == [vite]
    # Every skill has a category, so a project's new one is listed under "Other".
    assert vite in listed(db, SkillCategorySkill, "category_id", OTHER_CATEGORY_ID, "skill_id")
    assert db.get(Skill, vite).account_id == account_id
    # A skill the library already has, by name, isn't saved again, and a name must fit.
    assert error(apply(client, doc, message, "toolu_4"))[:2] == (422, "VALIDATION_FAILED")
    assert error(apply(client, doc, message, "toolu_5"))[:2] == (422, "VALIDATION_FAILED")


def test_waiting_proposals_that_wouldnt_fit_are_marked(client: TestClient, db: Session,
                                                       account_id: int,
                                                       monkeypatch: pytest.MonkeyPatch):
    """Marked against the document as it is each time the chat is read, never stored, and only
    when the change is what takes it past its pages (app/page_fit.py, page_mark)."""
    # One page of six lines; the resume's Experience takes four (its title, the role, and two
    # bullets), and has no header.
    monkeypatch.setattr(page_fit, "LINES_PER_PAGE", 6)
    monkeypatch.setattr(page_fit, "RESUME_PAGES", 1)
    doc, ids = setup_resume(db, account_id)
    job = {"parent_kind": "experience", "parent_id": ids["job"]}
    message = proposed(
        db, account_id, doc,
        # One more line still fits.
        change("add", "bullet", EXPERIENCE_SECTION_ID, ids["Led a team"], **job),
        # Three more lines make Experience too long for a page, and one line over.
        change("add", "bullet", EXPERIENCE_SECTION_ID, 0, new_text="Mentored. " * 30, **job),
        change("remove", "bullet", EXPERIENCE_SECTION_ID, ids["Tested it"], **job))
    marks = {p["id"]: p["page"] for p in client.get(
        f"/api/resumes/{doc.resume_id}/chat").json()[1]["proposals"]}
    assert marks == {"toolu_1": None, "toolu_3": None, "toolu_2": {
        "limit": 1, "pages": 1.2, "over_lines": 1, "too_long": ["Experience"]}}
    # Estimating changed nothing.
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(BulletPoint)) == 3
    assert client.get(f"/api/resumes/{doc.resume_id}").json()["fit"]["fits"]

    # Once the resume is already too long, a trim and a rewording of the same length aren't
    # marked: they don't take it past its pages.
    monkeypatch.setattr(page_fit, "LINES_PER_PAGE", 3)
    later = proposed(db, account_id, doc,
                     change("reword", "bullet", EXPERIENCE_SECTION_ID, ids["Shipped it"],
                            new_text="Shipped.", **job))
    chat = client.get(f"/api/resumes/{doc.resume_id}/chat").json()
    assert chat[1]["proposals"][2]["page"] is None
    assert chat[3]["proposals"][0]["page"] is None

    # Applied or dismissed ones aren't marked, and each response marks as of then.
    monkeypatch.setattr(page_fit, "LINES_PER_PAGE", 6)
    body = apply(client, doc, message, "toolu_1").json()
    assert [p["page"] for p in body["message"]["proposals"]][:2] == [None, {
        "limit": 1, "pages": 1.3, "over_lines": 2, "too_long": ["Experience"]}]
    dismissed = client.put(url(doc, later), json={"state": "dismissed"}).json()
    assert dismissed["proposals"][0]["page"] is None


def test_a_sent_documents_chat_is_never_marked(client: TestClient, db: Session,
                                               account_id: int,
                                               monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(page_fit, "LINES_PER_PAGE", 3)
    doc, ids = setup_resume(db, account_id, sent=True)
    proposed(db, account_id, doc, change("add", "bullet", EXPERIENCE_SECTION_ID,
                                         ids["Led a team"], parent_kind="experience",
                                         parent_id=ids["job"]))
    [_, message] = client.get(f"/api/resumes/{doc.resume_id}/chat").json()
    assert message["proposals"][0]["page"] is None
