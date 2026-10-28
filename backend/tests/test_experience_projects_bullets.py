"""Experience, projects, and bullet points (docs/FRONTEND_CHECKS.md: "Delete warnings",
"Sent versions are locked", "Suggesting and adding items")."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EXPERIENCE_SECTION_ID,
    PROJECTS_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    CoverLetterBulletPoint,
    CoverLetterExperience,
    CoverLetterSection,
    Experience,
    ExperienceBulletPoint,
    Project,
    ProjectBulletPoint,
    ProjectSkill,
    Resume,
    ResumeBulletPoint,
    ResumeExperience,
    ResumeProject,
    ResumeSection,
    Section,
    SectionBulletPoint,
    SectionExperience,
    SectionProject,
    Skill,
)
from tests.test_sections_skills import add, error, resume

ROLE = {"role_title": "Engineer", "organization": "Acme", "location": "Remote",
       "dates": "2020 – 2022"}


def role(db: Session, account_id: int, bullets: list[str] = (), section_id: int | None = None,
        **values) -> Experience:
    row = add(db, Experience(account_id=account_id, **{**ROLE, **values}))
    if section_id is not None:
        add(db, SectionExperience(section_id=section_id, experience_id=row.experience_id,
                                  position=row.experience_id))
    for position, content in enumerate(bullets, start=1):
        add(db, ExperienceBulletPoint(experience_id=row.experience_id,
                                      bullet_id=bullet(db, account_id, content).bullet_id,
                                      position=position))
    return row


def bullet(db: Session, account_id: int, content: str) -> BulletPoint:
    return db.scalar(select(BulletPoint).where(BulletPoint.content == content)) or add(
        db, BulletPoint(account_id=account_id, content=content))


def show_job(db: Session, doc: Resume, experience: Experience, bullets: list[str]) -> int:
    """Put the role and these bullets under it in the resume's Experience section."""
    section = add(db, ResumeSection(resume_id=doc.resume_id, section_id=EXPERIENCE_SECTION_ID,
                                    position=1))
    chosen = add(db, ResumeExperience(resume_section_id=section.resume_section_id,
                                      experience_id=experience.experience_id, position=1))
    for position, content in enumerate(bullets, start=1):
        add(db, ResumeBulletPoint(resume_section_id=section.resume_section_id,
                                  resume_experience_id=chosen.resume_experience_id,
                                  bullet_id=bullet(db, doc.account_id, content).bullet_id,
                                  position=position))
    return chosen.resume_experience_id


def listed(db: Session, link, parent_col: str, parent_id: int, child_col: str) -> list[int]:
    table = link.__table__
    return list(db.scalars(select(table.c[child_col]).where(table.c[parent_col] == parent_id)
                           .order_by(table.c.position)))


def contents(response) -> list[str]:
    return contents_of(response.json())


def contents_of(body: dict) -> list[str]:
    return [item["content"] for item in body["bullets"]]


# Experience


def test_new_job_is_listed_under_experience_by_default(client: TestClient, account_id: int):
    created = client.post("/api/experience", json={"role_title": " Engineer ",
                                                   "organization": "Acme", "location": "  "})
    assert created.status_code == 201
    body = created.json()
    assert (body["role_title"], body["location"], body["dates"]) == ("Engineer", None, None)
    assert body["sections"] == [{"id": EXPERIENCE_SECTION_ID, "title": "Experience"}]
    unlisted = client.post("/api/experience", json={**ROLE, "section_id": None}).json()
    assert unlisted["sections"] == []


def test_role_needs_a_title_and_organization(client: TestClient, account_id: int):
    response = client.post("/api/experience", json={**ROLE, "organization": " "})
    assert error(response) == (422, "VALIDATION_FAILED", "organization")


def test_another_accounts_job_or_section_is_not_found(client: TestClient, db: Session,
                                                      account_id: int):
    other = add(db, Account()).account_id
    theirs = role(db, other)
    their_section = add(db, Section(account_id=other, title="Theirs"))
    assert error(client.get(f"/api/experience/{theirs.experience_id}"))[1] == "NOT_FOUND"
    response = client.post("/api/experience", json={**ROLE, "section_id": their_section.id})
    assert error(response)[1] == "NOT_FOUND"


def test_set_job_bullets_in_order(client: TestClient, db: Session, account_id: int):
    row = role(db, account_id, ["Shipped it", "Tested it"])
    first, second = (bullet(db, account_id, text).bullet_id for text in ("Shipped it", "Tested it"))
    response = client.put(f"/api/experience/{row.experience_id}/bullets",
                          json={"bullet_ids": [second, first]})
    assert contents(response) == ["Tested it", "Shipped it"]
    response = client.put(f"/api/experience/{row.experience_id}/bullets",
                          json={"bullet_ids": [second]})
    assert contents(response) == ["Tested it"]
    assert db.get(BulletPoint, first) is not None  # taken out of the list, kept in the library


def test_job_bullet_list_errors(client: TestClient, db: Session, account_id: int):
    row = role(db, account_id, ["Shipped it"])
    mine = bullet(db, account_id, "Shipped it").bullet_id
    theirs = add(db, BulletPoint(account_id=add(db, Account()).account_id, content="Theirs"))
    url = f"/api/experience/{row.experience_id}/bullets"
    assert error(client.put(url, json={"bullet_ids": [mine, mine]}))[1] == "DUPLICATE"
    assert error(client.put(url, json={"bullet_ids": [theirs.bullet_id]}))[1] == \
        "CROSS_ACCOUNT_LINK"
    assert error(client.put(url, json={"bullet_ids": [999999]}))[1] == "NOT_FOUND"


def test_new_version_of_a_job_shares_its_bullets(client: TestClient, db: Session,
                                                 account_id: int):
    original = role(db, account_id, ["Shipped it", "Tested it"], section_id=EXPERIENCE_SECTION_ID)
    later = role(db, account_id, section_id=EXPERIENCE_SECTION_ID, organization="Later Co")
    doc = resume(db, account_id, "Draft", sent=False)
    show_job(db, doc, original, ["Shipped it"])
    response = client.post(f"/api/experience/{original.experience_id}/versions",
                           json={**ROLE, "role_title": "Senior Engineer"})
    assert response.status_code == 201
    version = response.json()
    assert contents(response) == ["Shipped it", "Tested it"]
    assert version["used_by"] == []  # nothing switches to a new version
    in_section = listed(db, SectionExperience, "section_id", EXPERIENCE_SECTION_ID,
                        "experience_id")
    assert in_section == [original.experience_id, version["experience_id"], later.experience_id]
    names = [(e["role_title"], e["organization"]) for e in client.get("/api/experience").json()]
    assert names == [("Engineer", "Acme"), ("Senior Engineer", "Acme"), ("Engineer", "Later Co")]


def change_job(client: TestClient, row: Experience, apply: bool, **values) -> dict:
    return client.put(f"/api/experience/{row.experience_id}",
                      json={**ROLE, **values, "apply_to_unsent": apply}).json()


def test_change_a_job_nothing_uses_in_place(client: TestClient, db: Session, account_id: int):
    row = role(db, account_id)
    saved = change_job(client, row, apply=False, dates="2020")
    assert (saved["experience_id"], saved["dates"]) == (row.experience_id, "2020")


@pytest.mark.parametrize(("apply", "in_place"), [(True, True), (False, False)])
def test_change_a_job_in_progress_resumes_use_only_if_told(client: TestClient, db: Session,
                                                           account_id: int, apply, in_place):
    row = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    draft_job = show_job(db, resume(db, account_id, "Draft", sent=False), row, ["Shipped it"])
    saved = change_job(client, row, apply=apply, dates=None)
    assert (saved["experience_id"] == row.experience_id) is in_place
    assert saved["dates"] is None
    db.expire_all()
    # In place, the draft's role is the changed one; as a new row, it keeps the original.
    assert db.get(ResumeExperience, draft_job).experience_id == row.experience_id
    if not in_place:
        assert db.get(Experience, row.experience_id).dates == ROLE["dates"]
        assert contents_of(saved) == ["Shipped it"]
        assert saved["used_by"] == []


@pytest.mark.parametrize("apply", [True, False])
def test_change_a_job_a_sent_version_uses_always_saves_a_new_one(client: TestClient, db: Session,
                                                                 account_id: int, apply):
    row = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    show_job(db, resume(db, account_id, "Sent", sent=True), row, ["Shipped it"])
    draft_job = show_job(db, resume(db, account_id, "Draft", sent=False), row, ["Shipped it"])
    saved = change_job(client, row, apply=apply, role_title="Lead Engineer")
    assert saved["experience_id"] != row.experience_id
    assert saved["sections"] == [{"id": EXPERIENCE_SECTION_ID, "title": "Experience"}]
    db.expire_all()
    assert db.get(Experience, row.experience_id).role_title == "Engineer"
    expected = saved["experience_id"] if apply else row.experience_id
    assert db.get(ResumeExperience, draft_job).experience_id == expected
    # The draft's bullets stay under its role either way.
    assert db.scalar(select(ResumeBulletPoint.resume_experience_id)
                     .where(ResumeBulletPoint.resume_experience_id == draft_job)) == draft_job


def test_a_version_with_nothing_changed_returns_the_original(client: TestClient, db: Session,
                                                             account_id: int):
    row = role(db, account_id)
    response = client.post(f"/api/experience/{row.experience_id}/versions", json=ROLE)
    assert (response.status_code, response.json()["experience_id"]) == (200, row.experience_id)


def test_delete_job_removes_it_and_its_bullets_from_resumes(client: TestClient, db: Session,
                                                            account_id: int):
    row = role(db, account_id, ["Shipped it"])
    doc = resume(db, account_id, "Draft", sent=False)
    chosen = show_job(db, doc, row, ["Shipped it"])
    assert client.delete(f"/api/experience/{row.experience_id}").status_code == 204
    assert db.get(ResumeExperience, chosen) is None
    assert db.scalar(select(ResumeBulletPoint)
                     .where(ResumeBulletPoint.resume_experience_id == chosen)) is None
    assert bullet(db, account_id, "Shipped it").bullet_id is not None


# Projects


def test_new_project_is_listed_under_projects_by_default(client: TestClient, account_id: int):
    body = client.post("/api/projects", json={"project_title": "Tweaker",
                                              "done_for": "Freelance"}).json()
    assert (body["done_for"], body["url"]) == ("Freelance", None)
    assert body["sections"] == [{"id": PROJECTS_SECTION_ID, "title": "Projects"}]


def test_project_skills_and_bullets(client: TestClient, db: Session, account_id: int):
    project = add(db, Project(account_id=account_id, project_title="Tweaker"))
    python, react = (add(db, Skill(account_id=account_id, skill_name=name)).skill_id
                     for name in ("Python", "React"))
    response = client.put(f"/api/projects/{project.project_id}/skills",
                          json={"skill_ids": [react, python]})
    assert [skill["skill_name"] for skill in response.json()["skills"]] == ["React", "Python"]
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    response = client.put(f"/api/projects/{project.project_id}/bullets",
                          json={"bullet_ids": [shipped]})
    assert contents(response) == ["Shipped it"]


def test_new_version_of_a_project_shares_skills_and_bullets(client: TestClient, db: Session,
                                                            account_id: int):
    project = add(db, Project(account_id=account_id, project_title="Tweaker"))
    add(db, SectionProject(section_id=PROJECTS_SECTION_ID, project_id=project.project_id,
                           position=1))
    python = add(db, Skill(account_id=account_id, skill_name="Python")).skill_id
    add(db, ProjectSkill(project_id=project.project_id, skill_id=python, position=1))
    add(db, ProjectBulletPoint(project_id=project.project_id,
                               bullet_id=bullet(db, account_id, "Shipped it").bullet_id,
                               position=1))
    version = client.post(f"/api/projects/{project.project_id}/versions",
                          json={"project_title": "Tweaker", "done_for": "Acme"}).json()
    assert [skill["skill_name"] for skill in version["skills"]] == ["Python"]
    assert [b["content"] for b in version["bullets"]] == ["Shipped it"]
    assert version["sections"] == [{"id": PROJECTS_SECTION_ID, "title": "Projects"}]


def test_change_a_project_a_sent_version_uses_saves_a_new_one(client: TestClient, db: Session,
                                                              account_id: int):
    project = add(db, Project(account_id=account_id, project_title="Tweaker", dates="2024"))
    sent = resume(db, account_id, "Sent", sent=True)
    section = add(db, ResumeSection(resume_id=sent.resume_id, section_id=PROJECTS_SECTION_ID,
                                    position=1))
    chosen = add(db, ResumeProject(resume_section_id=section.resume_section_id,
                                   project_id=project.project_id, position=1))
    saved = client.put(f"/api/projects/{project.project_id}",
                       json={"project_title": "Resume Tweaker", "dates": "2024",
                             "apply_to_unsent": True}).json()
    assert saved["project_id"] != project.project_id
    db.expire_all()
    assert db.get(Project, project.project_id).project_title == "Tweaker"
    assert db.get(ResumeProject, chosen.resume_project_id).project_id == project.project_id


@pytest.mark.parametrize(("apply", "in_place"), [(True, True), (False, False)])
def test_change_a_project_in_progress_resumes_use_only_if_told(client: TestClient, db: Session,
                                                               account_id: int, apply, in_place):
    project = add(db, Project(account_id=account_id, project_title="Tweaker", dates="2024"))
    draft = resume(db, account_id, "Draft", sent=False)
    section = add(db, ResumeSection(resume_id=draft.resume_id, section_id=PROJECTS_SECTION_ID,
                                    position=1))
    chosen = add(db, ResumeProject(resume_section_id=section.resume_section_id,
                                   project_id=project.project_id, position=1))
    saved = client.put(f"/api/projects/{project.project_id}",
                       json={"project_title": "Tweaker", "apply_to_unsent": apply}).json()
    assert (saved["project_id"] == project.project_id) is in_place
    assert saved["dates"] is None
    db.expire_all()
    # In place, the draft's project is the changed one; as a new row, it keeps the original.
    assert db.get(ResumeProject, chosen.resume_project_id).project_id == project.project_id
    assert db.get(Project, project.project_id).dates == (None if in_place else "2024")


# Bullet points


def test_new_bullet_is_listed_where_it_was_written(client: TestClient, db: Session,
                                                   account_id: int):
    row = role(db, account_id, ["Shipped it"])
    created = client.post("/api/bullet-points", json={"content": "Led it",
                                                      "experience_id": row.experience_id})
    assert created.status_code == 201
    assert [e["experience_id"] for e in created.json()["experience"]] == [row.experience_id]
    assert listed(db, ExperienceBulletPoint, "experience_id", row.experience_id, "bullet_id")[-1] \
        == created.json()["bullet_id"]
    in_section = client.post("/api/bullet-points", json={"content": "Spoke at a conference",
                                                         "section_id": EXPERIENCE_SECTION_ID})
    assert in_section.json()["sections"] == [{"id": EXPERIENCE_SECTION_ID, "title": "Experience"}]
    unlisted = client.post("/api/bullet-points", json={"content": "Loose"}).json()
    assert (unlisted["experience"], unlisted["projects"], unlisted["sections"]) == ([], [], [])


def test_bullet_lists_every_job_that_lists_it(client: TestClient, db: Session, account_id: int):
    role(db, account_id, ["Shipped it"])
    role(db, account_id, ["Shipped it"], role_title="Senior Engineer")
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    body = client.get(f"/api/bullet-points/{shipped}").json()
    assert [e["role_title"] for e in body["experience"]] == ["Engineer", "Senior Engineer"]


def test_edit_bullet_a_sent_version_uses_saves_a_new_bullet(client: TestClient, db: Session,
                                                            account_id: int):
    first = role(db, account_id, ["Shipped it", "Tested it"])
    second = role(db, account_id, ["Shipped it"], role_title="Senior Engineer")
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    sent = resume(db, account_id, "Sent", sent=True)
    draft = resume(db, account_id, "Draft", sent=False)
    show_job(db, sent, first, ["Shipped it"])
    show_job(db, draft, first, ["Shipped it"])
    letter = add(db, CoverLetter(account_id=account_id, name="Letter"))
    letter_section = add(db, CoverLetterSection(letter_id=letter.letter_id,
                                                section_id=EXPERIENCE_SECTION_ID, position=1))
    letter_job = add(db, CoverLetterExperience(
        cover_letter_section_id=letter_section.cover_letter_section_id,
        experience_id=first.experience_id, position=1))
    add(db, CoverLetterBulletPoint(cover_letter_section_id=letter_section.cover_letter_section_id,
                                   cover_letter_experience_id=letter_job.cover_letter_experience_id,
                                   bullet_id=shipped, position=1))

    saved = client.put(f"/api/bullet-points/{shipped}", json={"content": "Shipped it twice"}).json()
    new_id = saved["bullet_id"]
    assert new_id != shipped
    assert [use["name"] for use in saved["used_by"]] == ["Draft", "Letter"]
    tested = bullet(db, account_id, "Tested it").bullet_id
    assert listed(db, ExperienceBulletPoint, "experience_id", first.experience_id, "bullet_id") \
        == [shipped, new_id, tested]
    assert listed(db, ExperienceBulletPoint, "experience_id", second.experience_id, "bullet_id") \
        == [shipped, new_id]
    db.expire_all()
    assert db.get(BulletPoint, shipped).content == "Shipped it"
    sent_bullets = db.scalars(select(ResumeBulletPoint.bullet_id).join(ResumeSection)
                              .where(ResumeSection.resume_id == sent.resume_id)).all()
    assert sent_bullets == [shipped]


def test_edit_bullet_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    saved = client.put(f"/api/bullet-points/{shipped}", json={"content": "Shipped it!"}).json()
    assert (saved["bullet_id"], saved["content"]) == (shipped, "Shipped it!")


def test_delete_bullet_removes_it_everywhere(client: TestClient, db: Session, account_id: int):
    row = role(db, account_id, ["Shipped it"])
    chosen = show_job(db, resume(db, account_id, "Draft", sent=False), row, ["Shipped it"])
    shipped = bullet(db, account_id, "Shipped it").bullet_id
    assert client.delete(f"/api/bullet-points/{shipped}").status_code == 204
    assert listed(db, ExperienceBulletPoint, "experience_id", row.experience_id, "bullet_id") == []
    assert db.scalar(select(ResumeBulletPoint)
                     .where(ResumeBulletPoint.resume_experience_id == chosen)) is None
    assert db.get(ResumeExperience, chosen) is not None


# Section lists


@pytest.mark.parametrize(("path", "field", "key"), [
    ("experience", "experience_ids", "experience"),
    ("projects", "project_ids", "projects"),
    ("bullets", "bullet_ids", "bullets"),
])
def test_built_in_section_lists_keep_other_accounts_items(client: TestClient, db: Session,
                                                          account_id: int, path, field, key):
    other = add(db, Account()).account_id
    make = {
        "experience": lambda owner: role(db, owner).experience_id,
        "projects": lambda owner: add(db, Project(account_id=owner,
                                                  project_title=f"P{owner}")).project_id,
        "bullets": lambda owner: add(db, BulletPoint(account_id=owner,
                                                     content=f"B{owner}")).bullet_id,
    }[key]
    link, child_col = {"experience": (SectionExperience, "experience_id"),
                       "projects": (SectionProject, "project_id"),
                       "bullets": (SectionBulletPoint, "bullet_id")}[key]
    theirs = make(other)
    add(db, link(section_id=EXPERIENCE_SECTION_ID, position=1, **{child_col: theirs}))
    first, second = make(account_id), make(account_id) if key != "projects" else add(
        db, Project(account_id=account_id, project_title="Second")).project_id
    response = client.put(f"/api/sections/{EXPERIENCE_SECTION_ID}/{path}",
                          json={field: [second, first]})
    ids = [item[child_col] for item in response.json()[key]]
    assert ids == [second, first]
    assert theirs in listed(db, link, "section_id", EXPERIENCE_SECTION_ID, child_col)
