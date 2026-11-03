"""Hiding library items, and refusing to delete what a sent version uses (docs/FRONTEND_CHECKS.md,
"Hiding")."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    Education,
    Experience,
    Header,
    NarrativeContent,
    Project,
    Resume,
    ResumeSection,
    Section,
    SectionExperience,
    SignOff,
    Skill,
    SkillCategory,
    ToneSet,
)
from tests.test_defaults import add_sections, listed_role
from tests.test_document_tree import shape
from tests.test_sections_skills import add, error, resume

# Each kind: its url, and a row of it to add.
KINDS = {
    "headers": lambda account_id: Header(account_id=account_id, full_name="Sam Rivera"),
    "sections": lambda account_id: Section(account_id=account_id, title="Freelance"),
    "narrative-content": lambda account_id: NarrativeContent(account_id=account_id,
                                                             content="I build things."),
    "skill-categories": lambda account_id: SkillCategory(account_id=account_id,
                                                         category_name="Back End"),
    "skills": lambda account_id: Skill(account_id=account_id, skill_name="Go"),
    "experience": lambda account_id: Experience(account_id=account_id, role_title="Engineer",
                                                organization="Acme"),
    "projects": lambda account_id: Project(account_id=account_id, project_title="Tracker"),
    "bullet-points": lambda account_id: BulletPoint(account_id=account_id, content="Shipped it."),
    "education": lambda account_id: Education(account_id=account_id, degree="B.A.",
                                              institution="State"),
    "sign-offs": lambda account_id: SignOff(account_id=account_id, text="Best"),
    "tone-sets": lambda account_id: ToneSet(account_id=account_id, name="Tech"),
}


def row_id(row) -> int:
    return getattr(row, type(row).__table__.primary_key.columns[0].name)


@pytest.mark.parametrize("url", KINDS)
def test_any_library_item_can_be_hidden_and_unhidden(client: TestClient, db: Session,
                                                     account_id: int, url: str):
    item_id = row_id(add(db, KINDS[url](account_id)))
    assert client.get(f"/api/{url}/{item_id}").json()["hidden"] is False
    response = client.put(f"/api/{url}/{item_id}/hidden", json={"hidden": True})
    assert response.status_code == 200
    assert response.json()["hidden"] is True
    assert client.get(f"/api/{url}/{item_id}").json()["hidden"] is True
    response = client.put(f"/api/{url}/{item_id}/hidden", json={"hidden": False})
    assert response.json()["hidden"] is False


@pytest.mark.parametrize("url, item_id", [("sections", SUMMARY_SECTION_ID),
                                          ("skill-categories", OTHER_CATEGORY_ID)])
def test_built_in_items_cant_be_hidden(client: TestClient, account_id: int, url: str,
                                       item_id: int):
    response = client.put(f"/api/{url}/{item_id}/hidden", json={"hidden": True})
    assert error(response) == (409, "BUILT_IN_PROTECTED", None)


def test_another_accounts_item_cant_be_hidden(client: TestClient, db: Session, account_id: int):
    other = add(db, Account())
    bullet = add(db, BulletPoint(account_id=other.account_id, content="Theirs."))
    response = client.put(f"/api/bullet-points/{bullet.bullet_id}/hidden", json={"hidden": True})
    assert error(response) == (404, "NOT_FOUND", None)


def test_hiding_what_a_sent_version_uses_changes_it_in_place(client: TestClient, db: Session,
                                                             account_id: int):
    section = add(db, Section(account_id=account_id, title="Freelance"))
    doc = resume(db, account_id, "Sent", sent=True)
    add(db, ResumeSection(resume_id=doc.resume_id, section_id=section.id, position=1))
    response = client.put(f"/api/sections/{section.id}/hidden", json={"hidden": True})
    assert (response.json()["id"], response.json()["hidden"]) == (section.id, True)
    assert response.json()["used_by"][0]["locked"] is True


def test_deleting_what_a_sent_version_uses_is_refused(client: TestClient, db: Session,
                                                      account_id: int):
    section = add(db, Section(account_id=account_id, title="Freelance"))
    doc = resume(db, account_id, "Sent", sent=True)
    add(db, ResumeSection(resume_id=doc.resume_id, section_id=section.id, position=1))
    response = client.delete(f"/api/sections/{section.id}")
    assert error(response) == (409, "VERSION_LOCKED", None)
    assert response.json()["error"]["message"] == (
        "A sent application uses this section, so it can't be deleted. Hide it instead.")
    db.expire_all()
    assert db.get(Section, section.id) is not None


def test_deleting_what_only_unsent_versions_use_still_works(client: TestClient, db: Session,
                                                            account_id: int):
    sign_off = add(db, SignOff(account_id=account_id, text="Best"))
    add(db, CoverLetter(account_id=account_id, name="Draft", sign_off_id=sign_off.sign_off_id))
    assert client.delete(f"/api/sign-offs/{sign_off.sign_off_id}").status_code == 204


def test_hidden_items_are_never_defaults(client: TestClient, db: Session, account_id: int):
    teacher = listed_role(db, account_id, ["One.", "Two."])
    tutor = listed_role(db, account_id, ["Tutored."])
    client.put(f"/api/experience/{tutor.experience_id}/hidden", json={"hidden": True})
    one = db.query(BulletPoint).filter_by(content="One.").one()
    client.put(f"/api/bullet-points/{one.bullet_id}/hidden", json={"hidden": True})
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    sections = add_sections(client, doc, EXPERIENCE_SECTION_ID)
    two = db.query(BulletPoint).filter_by(content="Two.").one()
    assert shape(sections) == [
        (EXPERIENCE_SECTION_ID, [("experience", teacher.experience_id, [], [two.bullet_id])])]


def test_a_hidden_section_isnt_a_default_for_a_new_document(client: TestClient, db: Session,
                                                            account_id: int):
    freelance = add(db, Section(account_id=account_id, title="Freelance"))
    earlier = add(db, Resume(account_id=account_id, name="Earlier"))
    add_sections(client, earlier, freelance.id, EXPERIENCE_SECTION_ID)
    client.put(f"/api/sections/{freelance.id}/hidden", json={"hidden": True})
    created = client.post("/api/resumes", json={"name": "Later"}).json()
    assert [section["section_id"] for section in created["sections"]] == [EXPERIENCE_SECTION_ID]


def test_a_hidden_header_or_sign_off_isnt_a_default(client: TestClient, db: Session,
                                                    account_id: int):
    header = add(db, Header(account_id=account_id, full_name="Sam Rivera"))
    sign_off = add(db, SignOff(account_id=account_id, text="Sincerely"))
    client.put(f"/api/headers/{header.header_id}/hidden", json={"hidden": True})
    client.put(f"/api/sign-offs/{sign_off.sign_off_id}/hidden", json={"hidden": True})
    created = client.post("/api/cover-letters", json={"name": "Letter"}).json()
    assert (created["header_id"], created["sign_off_id"]) == (None, None)


def test_a_new_version_of_a_hidden_item_starts_unhidden(client: TestClient, db: Session,
                                                        account_id: int):
    role = add(db, Experience(account_id=account_id, role_title="Engineer", organization="Acme"))
    add(db, SectionExperience(section_id=EXPERIENCE_SECTION_ID, experience_id=role.experience_id,
                              position=1))
    client.put(f"/api/experience/{role.experience_id}/hidden", json={"hidden": True})
    version = client.post(f"/api/experience/{role.experience_id}/versions",
                          json={"role_title": "Senior Engineer", "organization": "Acme",
                                "location": None, "dates": None})
    assert version.json()["hidden"] is False
