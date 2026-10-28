"""Sections, skill categories, and skills (docs/FRONTEND_CHECKS.md: "Delete warnings",
"Deleting a skill category", "Sent versions are locked", "Suggesting and adding items")."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    Account,
    CoverLetter,
    CoverLetterSection,
    CoverLetterSkill,
    CoverLetterSkillCategory,
    JobPosting,
    Project,
    ProjectSkill,
    Resume,
    ResumeProject,
    ResumeProjectSkill,
    ResumeSection,
    ResumeSkill,
    ResumeSkillCategory,
    Section,
    SectionSkillCategory,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)


def add(db: Session, row):
    db.add(row)
    db.flush()
    return row


def category(db: Session, account_id: int, name: str, skills: list[str] = (),
             section_id: int | None = SKILLS_SECTION_ID) -> SkillCategory:
    row = add(db, SkillCategory(account_id=account_id, category_name=name))
    if section_id is not None:
        add(db, SectionSkillCategory(section_id=section_id, category_id=row.category_id,
                                     position=row.category_id))
    for position, skill_name in enumerate(skills, start=1):
        skill = db.scalar(select(Skill).where(Skill.skill_name == skill_name)) or add(
            db, Skill(account_id=account_id, skill_name=skill_name))
        add(db, SkillCategorySkill(category_id=row.category_id, skill_id=skill.skill_id,
                                   position=position))
    return row


def skill_id(db: Session, name: str) -> int:
    return db.scalar(select(Skill.skill_id).where(Skill.skill_name == name))


def resume(db: Session, account_id: int, name: str, sent: bool) -> Resume:
    posting = add(db, JobPosting(account_id=account_id, url="https://example.com",
                                 organization="Acme", role_title="Engineer",
                                 description="Build things.",
                                 applied_on=date(2026, 10, 1) if sent else None))
    return add(db, Resume(account_id=account_id, name=name, job_posting_id=posting.job_posting_id))


def show_skills(db: Session, doc: Resume, category_row: SkillCategory, skills: list[str],
                section_id: int = SKILLS_SECTION_ID, position: int = 1) -> ResumeSkillCategory:
    """Put the category and its skills in the resume's section (creating the section row)."""
    section = db.scalar(select(ResumeSection).where(
        ResumeSection.resume_id == doc.resume_id, ResumeSection.section_id == section_id)) or add(
        db, ResumeSection(resume_id=doc.resume_id, section_id=section_id, position=1))
    chosen = add(db, ResumeSkillCategory(resume_section_id=section.resume_section_id,
                                         category_id=category_row.category_id, position=position))
    for index, name in enumerate(skills, start=1):
        add(db, ResumeSkill(resume_skill_category_id=chosen.resume_skill_category_id,
                            skill_id=skill_id(db, name), position=index))
    return chosen


def shown(db: Session, chosen_id: int) -> list[str]:
    return list(db.scalars(select(Skill.skill_name).join(ResumeSkill)
                           .where(ResumeSkill.resume_skill_category_id == chosen_id)
                           .order_by(ResumeSkill.position)))


def listed(db: Session, category_id: int, account_id: int) -> list[str]:
    return list(db.scalars(select(Skill.skill_name).join(SkillCategorySkill)
                           .where(SkillCategorySkill.category_id == category_id,
                                  Skill.account_id == account_id)
                           .order_by(SkillCategorySkill.position)))


def error(response) -> tuple[int, str, str | None]:
    body = response.json()["error"]
    return response.status_code, body["code"], body["field"]


# Sections


def test_sections_list_built_ins_first(client: TestClient, db: Session, account_id: int):
    add(db, Section(account_id=account_id, title="Volunteer"))
    sections = client.get("/api/sections").json()
    assert [(s["title"], s["built_in"]) for s in sections] == [
        ("Summary", True), ("Skills", True), ("Experience", True), ("Projects", True),
        ("Education", True), ("Volunteer", False)]


@pytest.mark.parametrize("title", ["volunteer", "SKILLS"])
def test_section_titles_are_unique_ignoring_capitals(client: TestClient, db: Session,
                                                     account_id: int, title: str):
    add(db, Section(account_id=account_id, title="Volunteer"))
    response = client.post("/api/sections", json={"title": title})
    assert error(response) == (409, "DUPLICATE", "title")
    assert "already a section named" in response.json()["error"]["message"]


@pytest.mark.parametrize(("method", "kwargs"), [("put", {"json": {"title": "Abilities"}}),
                                                ("delete", {})])
def test_built_in_sections_are_protected(client: TestClient, account_id: int, method, kwargs):
    response = client.request(method, f"/api/sections/{SKILLS_SECTION_ID}", **kwargs)
    assert error(response) == (409, "BUILT_IN_PROTECTED", None)


def test_rename_section_in_place_when_no_sent_version_uses_it(client: TestClient, db: Session,
                                                              account_id: int):
    section = add(db, Section(account_id=account_id, title="Volunteer"))
    doc = resume(db, account_id, "Draft", sent=False)
    add(db, ResumeSection(resume_id=doc.resume_id, section_id=section.id, position=1))
    response = client.put(f"/api/sections/{section.id}", json={"title": "Volunteering"})
    assert (response.json()["id"], response.json()["title"]) == (section.id, "Volunteering")


def test_rename_section_a_sent_version_uses_saves_a_new_one(client: TestClient, db: Session,
                                                            account_id: int):
    section = add(db, Section(account_id=account_id, title="Freelance"))
    tools = category(db, account_id, "Tools", ["Git"], section_id=section.id)
    sent = add(db, ResumeSection(resume_id=resume(db, account_id, "Sent", True).resume_id,
                                 section_id=section.id, position=1))
    draft = add(db, ResumeSection(resume_id=resume(db, account_id, "Draft", False).resume_id,
                                  section_id=section.id, position=1))
    new = client.put(f"/api/sections/{section.id}", json={"title": "Consulting"}).json()
    assert new["id"] != section.id
    assert [c["category_id"] for c in new["skill_categories"]] == [tools.category_id]
    db.expire_all()
    assert (sent.section_id, draft.section_id) == (section.id, new["id"])
    assert db.get(Section, section.id).title == "Freelance"


def test_set_section_categories(client: TestClient, db: Session, account_id: int):
    first = category(db, account_id, "Front End", section_id=None)
    second = category(db, account_id, "Back End", section_id=None)
    response = client.put(f"/api/sections/{SKILLS_SECTION_ID}/skill-categories",
                          json={"category_ids": [second.category_id, first.category_id]})
    assert [c["category_name"] for c in response.json()["skill_categories"]] == [
        "Back End", "Front End"]


def test_built_in_section_lists_keep_other_accounts_categories(client: TestClient, db: Session,
                                                               account_id: int):
    other_account = add(db, Account())
    theirs = category(db, other_account.account_id, "Theirs")
    mine = category(db, account_id, "Mine", section_id=None)
    client.put(f"/api/sections/{SKILLS_SECTION_ID}/skill-categories",
               json={"category_ids": [mine.category_id]})
    listed_ids = set(db.scalars(select(SectionSkillCategory.category_id)
                                .where(SectionSkillCategory.section_id == SKILLS_SECTION_ID)))
    assert listed_ids == {theirs.category_id, mine.category_id}


def test_section_category_list_errors(client: TestClient, db: Session, account_id: int):
    mine = category(db, account_id, "Mine", section_id=None)
    theirs = category(db, add(db, Account()).account_id, "Theirs", section_id=None)
    url = f"/api/sections/{SKILLS_SECTION_ID}/skill-categories"
    cases = [([OTHER_CATEGORY_ID], (422, "VALIDATION_FAILED", "category_ids")),
             ([theirs.category_id], (422, "CROSS_ACCOUNT_LINK", "category_ids")),
             ([999_999], (404, "NOT_FOUND", "category_ids")),
             ([mine.category_id, mine.category_id], (409, "DUPLICATE", "category_ids"))]
    for ids, expected in cases:
        assert error(client.put(url, json={"category_ids": ids})) == expected, ids


def test_delete_section_removes_it_from_resumes(client: TestClient, db: Session,
                                                account_id: int):
    section = add(db, Section(account_id=account_id, title="Volunteer"))
    placed = add(db, ResumeSection(resume_id=resume(db, account_id, "Draft", False).resume_id,
                                   section_id=section.id, position=1))
    placed_id = placed.resume_section_id
    assert client.delete(f"/api/sections/{section.id}").status_code == 204
    db.expire_all()
    assert db.get(ResumeSection, placed_id) is None


# Skill categories


def test_new_category_is_listed_under_skills_by_default(client: TestClient, account_id: int):
    new = client.post("/api/skill-categories", json={"category_name": "Cloud"})
    assert new.status_code == 201
    assert [s["title"] for s in new.json()["sections"]] == ["Skills"]
    unlisted = client.post("/api/skill-categories",
                           json={"category_name": "Spare", "section_id": None}).json()
    assert unlisted["sections"] == []


@pytest.mark.parametrize("name", ["cloud", "OTHER"])
def test_category_names_are_unique_ignoring_capitals(client: TestClient, db: Session,
                                                     account_id: int, name: str):
    category(db, account_id, "Cloud")
    response = client.post("/api/skill-categories", json={"category_name": name})
    assert error(response) == (409, "DUPLICATE", "category_name")


@pytest.mark.parametrize(("method", "kwargs"), [("put", {"json": {"category_name": "Misc"}}),
                                                ("delete", {})])
def test_other_is_protected(client: TestClient, account_id: int, method, kwargs):
    response = client.request(method, f"/api/skill-categories/{OTHER_CATEGORY_ID}", **kwargs)
    assert error(response) == (409, "BUILT_IN_PROTECTED", None)


def test_rename_category_a_sent_version_uses_saves_a_new_one(client: TestClient, db: Session,
                                                             account_id: int):
    first = category(db, account_id, "Front End", ["React"])
    old = category(db, account_id, "Backend", ["Go", "Python"])
    last = category(db, account_id, "Tools", ["Git"])
    sent = show_skills(db, resume(db, account_id, "Sent", True), old, ["Go"])
    draft = show_skills(db, resume(db, account_id, "Draft", False), old, ["Python"])

    new = client.put(f"/api/skill-categories/{old.category_id}",
                     json={"category_name": "Back End"}).json()
    assert new["category_id"] != old.category_id
    assert [s["skill_name"] for s in new["skills"]] == ["Go", "Python"]
    db.expire_all()
    assert (sent.category_id, draft.category_id) == (old.category_id, new["category_id"])
    assert shown(db, draft.resume_skill_category_id) == ["Python"]
    in_skills = list(db.scalars(select(SectionSkillCategory.category_id)
                                .where(SectionSkillCategory.section_id == SKILLS_SECTION_ID)
                                .order_by(SectionSkillCategory.position)))
    assert in_skills == [first.category_id, old.category_id, new["category_id"],
                         last.category_id]


def test_set_category_skills_in_order(client: TestClient, db: Session, account_id: int):
    row = category(db, account_id, "Back End", ["Go", "Python"])
    other = category(db, account_id, "Data", ["SQL"])
    new_order = [skill_id(db, "SQL"), skill_id(db, "Go"), skill_id(db, "Python")]
    response = client.put(f"/api/skill-categories/{row.category_id}/skills",
                          json={"skill_ids": new_order})
    assert [s["skill_name"] for s in response.json()["skills"]] == ["SQL", "Go", "Python"]
    assert listed(db, other.category_id, account_id) == ["SQL"]


def test_a_skill_taken_out_of_its_only_category_goes_to_other(client: TestClient, db: Session,
                                                              account_id: int):
    row = category(db, account_id, "Back End", ["Go", "Python"])
    category(db, account_id, "Scripting", ["Python"])
    client.put(f"/api/skill-categories/{row.category_id}/skills", json={"skill_ids": []})
    assert listed(db, OTHER_CATEGORY_ID, account_id) == ["Go"]


def test_a_skill_with_no_other_category_cant_leave_other(client: TestClient, db: Session,
                                                         account_id: int):
    category(db, account_id, "Unused", section_id=None)
    add(db, Skill(account_id=account_id, skill_name="Go"))
    add(db, SkillCategorySkill(category_id=OTHER_CATEGORY_ID, skill_id=skill_id(db, "Go"),
                               position=1))
    response = client.put(f"/api/skill-categories/{OTHER_CATEGORY_ID}/skills",
                          json={"skill_ids": []})
    assert error(response) == (422, "VALIDATION_FAILED", "skill_ids")
    assert "Go" in response.json()["error"]["message"]
    assert listed(db, OTHER_CATEGORY_ID, account_id) == ["Go"]  # nothing changed


def test_delete_category_moves_skills_and_selections_to_other(client: TestClient, db: Session,
                                                              account_id: int):
    doomed = category(db, account_id, "Back End", ["Go", "Python", "SQL"])
    category(db, account_id, "Data", ["SQL"])
    doc = resume(db, account_id, "Draft", sent=False)
    other_skill = add(db, Skill(account_id=account_id, skill_name="Bash"))
    add(db, SkillCategorySkill(category_id=OTHER_CATEGORY_ID, skill_id=other_skill.skill_id,
                               position=1))
    add(db, SkillCategorySkill(category_id=OTHER_CATEGORY_ID, skill_id=skill_id(db, "Go"),
                               position=2))
    existing_other = show_skills(db, doc, db.get(SkillCategory, OTHER_CATEGORY_ID),
                                 ["Bash", "Go"], position=2)
    show_skills(db, doc, doomed, ["Python", "Go", "SQL"], position=1)

    doomed_id, other_row = doomed.category_id, existing_other.resume_skill_category_id
    assert client.delete(f"/api/skill-categories/{doomed_id}").status_code == 204
    db.expire_all()
    assert db.get(SkillCategory, doomed_id) is None
    # Python was only in Back End; Go was already in Other; SQL is still in Data.
    assert listed(db, OTHER_CATEGORY_ID, account_id) == ["Bash", "Go", "Python"]
    # Go was already shown under Other, so only Python and SQL move, after Bash and Go.
    assert shown(db, other_row) == ["Bash", "Go", "Python", "SQL"]


def test_delete_category_creates_other_at_its_position(client: TestClient, db: Session,
                                                       account_id: int):
    doomed = category(db, account_id, "Back End", ["Go"])
    doc = resume(db, account_id, "Sent", sent=True)
    show_skills(db, doc, doomed, ["Go"], position=3)
    client.delete(f"/api/skill-categories/{doomed.category_id}")
    moved = db.scalars(select(ResumeSkillCategory)).one()
    assert (moved.category_id, moved.position) == (OTHER_CATEGORY_ID, 3)
    assert shown(db, moved.resume_skill_category_id) == ["Go"]


def test_delete_category_moves_cover_letter_selections_too(client: TestClient, db: Session,
                                                           account_id: int):
    doomed = category(db, account_id, "Back End", ["Go"])
    letter = add(db, CoverLetter(account_id=account_id, name="Letter"))
    section = add(db, CoverLetterSection(letter_id=letter.letter_id,
                                         section_id=SKILLS_SECTION_ID, position=1))
    chosen = add(db, CoverLetterSkillCategory(
        cover_letter_section_id=section.cover_letter_section_id,
        category_id=doomed.category_id, position=1))
    add(db, CoverLetterSkill(cover_letter_skill_category_id=chosen.cover_letter_skill_category_id,
                             skill_id=skill_id(db, "Go"), position=1))
    client.delete(f"/api/skill-categories/{doomed.category_id}")
    moved = db.scalars(select(CoverLetterSkillCategory)).one()
    assert moved.category_id == OTHER_CATEGORY_ID
    assert db.scalars(select(CoverLetterSkill.skill_id)).all() == [skill_id(db, "Go")]


# Skills


def test_new_skill_goes_in_other_unless_a_category_is_picked(client: TestClient, db: Session,
                                                             account_id: int):
    back_end = category(db, account_id, "Back End")
    go = client.post("/api/skills", json={"skill_name": "Go"})
    assert go.status_code == 201
    assert [c["category_name"] for c in go.json()["categories"]] == ["Other"]
    rust = client.post("/api/skills", json={"skill_name": "Rust",
                                            "category_id": back_end.category_id}).json()
    assert [c["category_name"] for c in rust["categories"]] == ["Back End"]


def test_skill_names_are_unique_ignoring_capitals(client: TestClient, db: Session,
                                                  account_id: int):
    category(db, account_id, "Front End", ["JavaScript"])
    response = client.post("/api/skills", json={"skill_name": "javascript"})
    assert error(response) == (409, "DUPLICATE", "skill_name")
    assert '"JavaScript"' in response.json()["error"]["message"]
    rename = client.put(f"/api/skills/{skill_id(db, 'JavaScript')}",
                        json={"skill_name": "Javascript"})
    assert rename.json()["skill_name"] == "Javascript"  # its own name with new capitals


def test_rename_skill_a_sent_version_uses_saves_a_new_one(client: TestClient, db: Session,
                                                          account_id: int):
    row = category(db, account_id, "AI", ["Claude", "Gemini"])
    claude = skill_id(db, "Claude")
    project = add(db, Project(account_id=account_id, project_title="App"))
    add(db, ProjectSkill(project_id=project.project_id, skill_id=claude, position=1))
    sent = show_skills(db, resume(db, account_id, "Sent", True), row, ["Claude"])
    draft_doc = resume(db, account_id, "Draft", False)
    draft = show_skills(db, draft_doc, row, ["Gemini", "Claude"])
    draft_section = db.scalar(select(ResumeSection.resume_section_id)
                              .where(ResumeSection.resume_id == draft_doc.resume_id))
    draft_project = add(db, ResumeProject(resume_section_id=draft_section,
                                          project_id=project.project_id, position=2))
    add(db, ResumeProjectSkill(resume_project_id=draft_project.resume_project_id,
                               skill_id=claude, position=1))

    new = client.put(f"/api/skills/{claude}", json={"skill_name": "Claude Code"}).json()
    assert new["skill_id"] != claude
    assert [c["category_name"] for c in new["categories"]] == ["AI"]
    assert [p["project_title"] for p in new["projects"]] == ["App"]
    assert [use["name"] for use in new["used_by"]] == ["Draft"]  # once, though used twice
    db.expire_all()
    assert listed(db, row.category_id, account_id) == ["Claude", "Claude Code", "Gemini"]
    assert shown(db, sent.resume_skill_category_id) == ["Claude"]
    assert shown(db, draft.resume_skill_category_id) == ["Gemini", "Claude Code"]
    assert db.scalar(select(ResumeProjectSkill.skill_id)) == new["skill_id"]


def test_rename_skill_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    category(db, account_id, "AI", ["Claude"])
    claude = skill_id(db, "Claude")
    response = client.put(f"/api/skills/{claude}", json={"skill_name": "Claude Code"}).json()
    assert (response["skill_id"], response["skill_name"]) == (claude, "Claude Code")


def test_delete_skill(client: TestClient, db: Session, account_id: int):
    row = category(db, account_id, "AI", ["Claude"])
    chosen = show_skills(db, resume(db, account_id, "Draft", False), row, ["Claude"])
    assert client.delete(f"/api/skills/{skill_id(db, 'Claude')}").status_code == 204
    db.expire_all()
    assert shown(db, chosen.resume_skill_category_id) == []
    assert listed(db, row.category_id, account_id) == []
