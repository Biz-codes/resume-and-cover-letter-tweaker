"""Defaults for a resume's or cover letter's tree (docs/FRONTEND_CHECKS.md, "Defaults"): what the
latest other document used, or the first few the library lists."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    EXPERIENCE_SECTION_ID,
    SKILLS_SECTION_ID,
    BulletPoint,
    ExperienceBulletPoint,
    Resume,
    SectionExperience,
)
from tests.test_document_tree import listed_bullets, placing, role, shape
from tests.test_sections_skills import add, category, skill_id


def listed_role(db: Session, account_id: int, bullets: list[str]):
    """A role listed under Experience, with its bullets."""
    row = role(db, account_id, bullets)
    add(db, SectionExperience(section_id=EXPERIENCE_SECTION_ID,
                              experience_id=row.experience_id, position=row.experience_id))
    return row


def add_sections(client: TestClient, doc: Resume, *section_ids: int) -> list[dict]:
    return client.put(f"/api/resumes/{doc.resume_id}/sections",
                      json={"section_ids": list(section_ids)}).json()["sections"]


def test_a_new_section_starts_with_the_first_few_its_library_lists(client: TestClient,
                                                                   db: Session,
                                                                   account_id: int):
    teacher = listed_role(db, account_id, ["One.", "Two.", "Three.", "Four."])
    tutor = listed_role(db, account_id, ["Tutored."])
    teaching = category(db, account_id, "Teaching", ["Planning", "Grading", "Coaching",
                                                      "Testing"])
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    sections = add_sections(client, doc, EXPERIENCE_SECTION_ID, SKILLS_SECTION_ID)
    one, two, three, _ = listed_bullets(db, teacher.experience_id)
    (tutored,) = listed_bullets(db, tutor.experience_id)
    assert shape(sections) == [
        (EXPERIENCE_SECTION_ID, [("experience", teacher.experience_id, [], [one, two, three]),
                                 ("experience", tutor.experience_id, [], [tutored])]),
        (SKILLS_SECTION_ID, [("category", teaching.category_id,
                              [skill_id(db, name) for name in ("Planning", "Grading",
                                                               "Coaching")], [])])]


def test_defaults_follow_what_the_latest_document_used(client: TestClient, db: Session,
                                                       account_id: int):
    teacher = listed_role(db, account_id, ["One.", "Two.", "Three.", "Four."])
    _, two, three, four = listed_bullets(db, teacher.experience_id)
    earlier = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = add_sections(client, earlier, EXPERIENCE_SECTION_ID)[0]
    # Cleared of its defaults, then the role with bullets chosen out of order.
    client.put(f"/api/resumes/{earlier.resume_id}/sections/{work['row_id']}/items",
               json={"entries": []})
    client.post(f"/api/resumes/{earlier.resume_id}/sections/{work['row_id']}/items",
                json=placing({"kind": "experience", "item_id": teacher.experience_id,
                              "bullet_ids": [four, two, three]}))
    # A bullet the role no longer lists is left out.
    db.query(ExperienceBulletPoint).filter_by(bullet_id=three).delete()

    created = client.post("/api/resumes", json={"name": "Tutoring base"})
    assert created.status_code == 201
    assert shape(created.json()["sections"]) == [
        (EXPERIENCE_SECTION_ID, [("experience", teacher.experience_id, [], [four, two])])]


def test_an_empty_list_places_an_item_without_its_defaults(client: TestClient, db: Session,
                                                          account_id: int):
    teacher = role(db, account_id, ["One.", "Two."])
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = add_sections(client, doc, EXPERIENCE_SECTION_ID)[0]
    assert work["entries"] == []
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    placed = client.post(url, json=placing({"kind": "experience",
                                            "item_id": teacher.experience_id,
                                            "bullet_ids": []}))
    assert placed.json()["sections"][0]["entries"][0]["bullets"] == []


def test_default_bullets_leave_out_ones_already_in_the_section(client: TestClient, db: Session,
                                                               account_id: int):
    teacher = role(db, account_id, ["One.", "Two.", "Three.", "Four."])
    one, two, three, four = listed_bullets(db, teacher.experience_id)
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = add_sections(client, doc, EXPERIENCE_SECTION_ID)[0]
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    placed = client.post(url, json=placing({"kind": "bullet", "item_id": one},
                                           {"kind": "experience",
                                            "item_id": teacher.experience_id}))
    assert placed.status_code == 201
    assert shape(placed.json()["sections"]) == [
        (EXPERIENCE_SECTION_ID, [("bullet", one, [], []),
                                 ("experience", teacher.experience_id, [], [two, three, four])])]


def test_a_section_skips_a_default_bullet_a_default_role_shows(client: TestClient, db: Session,
                                                               account_id: int):
    teacher = role(db, account_id, ["One."])
    (one,) = listed_bullets(db, teacher.experience_id)
    other = add(db, BulletPoint(account_id=account_id, content="Other."))

    def build(name: str, *items: dict) -> None:
        doc = add(db, Resume(account_id=account_id, name=name))
        work = add_sections(client, doc, EXPERIENCE_SECTION_ID)[0]
        url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
        # Cleared of its defaults first.
        client.put(url, json={"entries": []})
        assert client.post(url, json=placing(*items)).status_code == 201

    # The role last showed its bullet here...
    build("Teaching base", {"kind": "experience", "item_id": teacher.experience_id})
    # ...and the section last held the role without it, and the bullet on its own.
    build("Tutoring base", {"kind": "experience", "item_id": teacher.experience_id,
                            "bullet_ids": []},
          {"kind": "bullet", "item_id": one}, {"kind": "bullet", "item_id": other.bullet_id})
    later = add(db, Resume(account_id=account_id, name="Mentoring base"))
    sections = add_sections(client, later, EXPERIENCE_SECTION_ID)
    # The role takes its bullet back, so the bullet isn't placed on its own too.
    assert shape(sections) == [
        (EXPERIENCE_SECTION_ID, [("experience", teacher.experience_id, [], [one]),
                                 ("bullet", other.bullet_id, [], [])])]
    assert [entry["position"] for entry in sections[0]["entries"]] == [1, 2]
