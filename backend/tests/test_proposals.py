"""Applying and dismissing Claude's proposals from the chat (app/proposals.py;
docs/FRONTEND_CHECKS.md, "Chat with Claude")."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

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
