"""Building a resume's or cover letter's tree: sections, the items in them, and their skills and
bullets (docs/FRONTEND_CHECKS.md, "Suggesting and adding items" and "Sent versions are
locked")."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EDUCATION_SECTION_ID,
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    Education,
    Experience,
    ExperienceBulletPoint,
    NarrativeContent,
    ProjectBulletPoint,
    ProjectSkill,
    Resume,
    Section,
    SectionBulletPoint,
    SectionExperience,
    SectionNarrativeContent,
    SignOff,
    Skill,
    SkillCategorySkill,
)
from tests.test_documents import build_resume, header, posting
from tests.test_sections_skills import add, category, error, skill_id


def tree(client: TestClient, resume_id: int) -> list[dict]:
    return client.get(f"/api/resumes/{resume_id}").json()["sections"]


def shape(sections: list[dict]) -> list[tuple]:
    """Each section's id and its items' kinds and ids, with their skills and bullets."""
    return [(section["section_id"],
             [(entry["kind"], entry["item_id"], [skill["item_id"] for skill in entry["skills"]],
               [bullet["item_id"] for bullet in entry["bullets"]])
              for entry in section["entries"]])
            for section in sections]


def role(db: Session, account_id: int, bullets: list[str] = ()) -> Experience:
    row = add(db, Experience(account_id=account_id, role_title="Engineer", organization="Acme"))
    for position, text in enumerate(bullets, start=1):
        bullet = add(db, BulletPoint(account_id=account_id, content=text))
        add(db, ExperienceBulletPoint(experience_id=row.experience_id,
                                      bullet_id=bullet.bullet_id, position=position))
    return row


def placing(*items: dict) -> dict:
    """The body that places saved items in a section."""
    return {"items": list(items)}


def listed_bullets(db: Session, experience_id: int) -> list[int]:
    return list(db.scalars(select(ExperienceBulletPoint.bullet_id)
                           .where(ExperienceBulletPoint.experience_id == experience_id)
                           .order_by(ExperienceBulletPoint.position)))


# Sections


def test_add_reorder_and_remove_sections(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    before = tree(client, doc.resume_id)
    rows = {section["section_id"]: section["row_id"] for section in before}
    own = add(db, Section(account_id=account_id, title="Talks"))
    url = f"/api/resumes/{doc.resume_id}/sections"
    order = [EXPERIENCE_SECTION_ID, SUMMARY_SECTION_ID, own.id, EDUCATION_SECTION_ID]
    saved = client.put(url, json={"section_ids": order})
    assert saved.status_code == 200
    after = saved.json()["sections"]
    assert [section["section_id"] for section in after] == order
    # Kept sections keep their rows and contents; new ones start empty.
    assert after[0]["row_id"] == rows[EXPERIENCE_SECTION_ID]
    assert shape(after)[:2] == [shape(before)[2], shape(before)[0]]
    assert after[2]["entries"] == after[3]["entries"] == []
    assert saved.json()["output"]["text"].startswith("Experience\n")
    # A removed section takes what was placed in it.
    assert [section["section_id"] for section in tree(client, doc.resume_id)] == order
    assert client.put(url, json={"section_ids": []}).json()["sections"] == []


def test_sections_must_be_the_accounts_own_and_listed_once(client: TestClient, db: Session,
                                                          account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    theirs = add(db, Section(account_id=add(db, Account()).account_id, title="Theirs"))
    url = f"/api/resumes/{doc.resume_id}/sections"
    assert error(client.put(url, json={"section_ids": [theirs.id]})) == (
        422, "CROSS_ACCOUNT_LINK", "section_ids")
    assert error(client.put(url, json={"section_ids": [999999]})) == (
        404, "NOT_FOUND", "section_ids")
    assert error(client.put(url, json={"section_ids": [SUMMARY_SECTION_ID] * 2}))[:2] == (
        409, "DUPLICATE")


# Items in a section


def test_items_of_any_kind_share_one_order(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    work = tree(client, doc.resume_id)[2]
    assert [entry["kind"] for entry in work["entries"]] == ["experience", "education"]
    experience, education = work["entries"]
    intro = add(db, NarrativeContent(account_id=account_id, content="Recent work:"))
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    saved = client.put(url, json={"entries": [
        {"kind": "education", "item_id": education["item_id"]},
        {"kind": "narrative", "item_id": intro.content_id},
        {"kind": "experience", "item_id": experience["item_id"]}]})
    assert saved.status_code == 200
    entries = saved.json()["sections"][2]["entries"]
    assert [(entry["kind"], entry["position"]) for entry in entries] == [
        ("education", 1), ("narrative", 2), ("experience", 3)]
    # The role kept its row, so its bullets stayed.
    assert entries[2]["row_id"] == experience["row_id"]
    assert [bullet["text"] for bullet in entries[2]["bullets"]] == [
        "Led the redesign.", "Cut load time in half."]

    removed = client.put(url, json={"entries": [
        {"kind": "narrative", "item_id": intro.content_id}]}).json()["sections"][2]["entries"]
    assert [entry["kind"] for entry in removed] == ["narrative"]
    # Taking the role out took its bullets; adding it back starts with none.
    back = client.put(url, json={"entries": [
        {"kind": "experience", "item_id": experience["item_id"]}]}).json()
    assert back["sections"][2]["entries"][0]["bullets"] == []


def test_items_must_be_the_accounts_own_and_placed_once(client: TestClient, db: Session,
                                                       account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    sections = tree(client, doc.resume_id)
    work = sections[2]
    nested = work["entries"][0]["bullets"][0]["item_id"]
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    current = [{"kind": entry["kind"], "item_id": entry["item_id"]} for entry in work["entries"]]
    other = add(db, Account()).account_id
    theirs = add(db, Education(account_id=other, degree="PhD", institution="Elsewhere"))
    assert error(client.put(url, json={"entries": [
        *current, {"kind": "education", "item_id": theirs.education_id}]})) == (
        422, "CROSS_ACCOUNT_LINK", "entries")
    assert error(client.put(url, json={"entries": [*current, current[0]]}))[:2] == (
        409, "DUPLICATE")
    # A bullet under the role can't also sit directly in the same section.
    assert error(client.put(url, json={"entries": [
        *current, {"kind": "bullet", "item_id": nested}]})) == (409, "DUPLICATE", "entries")
    # Another document's section isn't found.
    other_doc = add(db, Resume(account_id=account_id, name="Other"))
    assert error(client.put(f"/api/resumes/{other_doc.resume_id}/sections/{work['row_id']}/items",
                            json={"entries": []}))[:2] == (404, "NOT_FOUND")
    assert shape(tree(client, doc.resume_id)) == shape(sections)


# Skills and bullets under an item


def test_category_skills_come_from_its_list(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    chosen = tree(client, doc.resume_id)[1]["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/category/{chosen['row_id']}/skills"
    order = [skill_id(db, "CSS"), skill_id(db, "TypeScript")]
    saved = client.put(url, json={"skill_ids": order}).json()
    assert [skill["item_id"] for skill in saved["sections"][1]["entries"][0]["skills"]] == order
    assert "Front End: CSS, TypeScript" in saved["output"]["text"]
    unlisted = add(db, Skill(account_id=account_id, skill_name="Go"))
    assert error(client.put(url, json={"skill_ids": [unlisted.skill_id]})) == (
        422, "VALIDATION_FAILED", "skill_ids")
    # The row must be one of this document's entries.
    other = add(db, Resume(account_id=account_id, name="Other"))
    assert error(client.put(f"/api/resumes/{other.resume_id}/items/category/{chosen['row_id']}"
                            "/skills", json={"skill_ids": []}))[:2] == (404, "NOT_FOUND")


def test_project_skills_can_be_any_of_the_accounts_skills(client: TestClient, db: Session,
                                                          account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    project = tree(client, doc.resume_id)[3]["entries"][0]
    category(db, account_id, "Tools", ["Git"])
    url = f"/api/resumes/{doc.resume_id}/items/project/{project['row_id']}/skills"
    saved = client.put(url, json={"skill_ids": [skill_id(db, "Git"), skill_id(db, "React")]})
    assert "Skills: Git, React" in saved.json()["output"]["text"]


def test_role_bullets_come_from_its_list(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    work = tree(client, doc.resume_id)[2]
    placed = work["entries"][0]
    listed = [bullet["item_id"] for bullet in placed["bullets"]]
    for position, bullet_id in enumerate(listed, start=1):
        add(db, ExperienceBulletPoint(experience_id=placed["item_id"], bullet_id=bullet_id,
                                      position=position))
    spare = add(db, BulletPoint(account_id=account_id, content="Mentored two engineers."))
    add(db, ExperienceBulletPoint(experience_id=placed["item_id"], bullet_id=spare.bullet_id,
                                  position=3))
    url = f"/api/resumes/{doc.resume_id}/items/experience/{placed['row_id']}/bullets"
    saved = client.put(url, json={"bullet_ids": [spare.bullet_id, listed[0]]}).json()
    assert [bullet["text"] for bullet in saved["sections"][2]["entries"][0]["bullets"]] == [
        "Mentored two engineers.", "Led the redesign."]
    unlisted = add(db, BulletPoint(account_id=account_id, content="Not this role's."))
    assert error(client.put(url, json={"bullet_ids": [unlisted.bullet_id]})) == (
        422, "VALIDATION_FAILED", "bullet_ids")

    # A bullet already placed directly in the section can't go under the role too.
    add(db, SectionBulletPoint(section_id=EXPERIENCE_SECTION_ID, bullet_id=listed[1],
                               position=1))
    items = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    client.put(items, json={"entries": [
        {"kind": "experience", "item_id": placed["item_id"]},
        {"kind": "bullet", "item_id": listed[1]}]})
    assert error(client.put(url, json={"bullet_ids": [listed[1]]})) == (
        409, "DUPLICATE", "bullet_ids")


# Writing new content in place


def test_write_narrative_content_and_bullets_in_a_section(client: TestClient, db: Session,
                                                         account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    summary = tree(client, doc.resume_id)[0]
    url = f"/api/resumes/{doc.resume_id}/sections/{summary['row_id']}/written"
    written = client.post(url, json={"kind": "narrative", "content": " Open to remote work. "})
    assert written.status_code == 201
    entries = written.json()["sections"][0]["entries"]
    assert [(entry["kind"], entry["position"]) for entry in entries] == [
        ("narrative", 1), ("narrative", 2), ("bullet", 3), ("narrative", 4)]
    assert entries[3]["values"]["content"] == "Open to remote work."
    # Saved to the library, listed under the section.
    assert db.scalar(select(SectionNarrativeContent.section_id)
                     .where(SectionNarrativeContent.content_id == entries[3]["item_id"])) == (
        SUMMARY_SECTION_ID)

    bullet = client.post(url, json={"kind": "bullet", "content": "Runs a study group."}).json()
    last = bullet["sections"][0]["entries"][-1]
    assert (last["kind"], last["position"]) == ("bullet", 5)
    assert db.scalar(select(SectionBulletPoint.section_id)
                     .where(SectionBulletPoint.bullet_id == last["item_id"])) == (
        SUMMARY_SECTION_ID)
    assert error(client.post(url, json={"kind": "bullet", "content": " "}))[:3] == (
        422, "VALIDATION_FAILED", "content")


def test_write_a_bullet_under_a_role_or_project(client: TestClient, db: Session,
                                               account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    sections = tree(client, doc.resume_id)
    placed = sections[2]["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/experience/{placed['row_id']}/written"
    saved = client.post(url, json={"content": "Shipped the new checkout."})
    assert saved.status_code == 201
    bullets = saved.json()["sections"][2]["entries"][0]["bullets"]
    assert [bullet["text"] for bullet in bullets][-1] == "Shipped the new checkout."
    assert listed_bullets(db, placed["item_id"]) == [bullets[-1]["item_id"]]

    project = sections[3]["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/project/{project['row_id']}/written"
    bullets = client.post(url, json={"content": "Wrote the docs."}).json()[
        "sections"][3]["entries"][0]["bullets"]
    assert [bullet["text"] for bullet in bullets] == ["Built it with Claude.", "Wrote the docs."]
    assert db.scalar(select(ProjectBulletPoint.project_id)
                     .where(ProjectBulletPoint.bullet_id == bullets[1]["item_id"])) == (
        project["item_id"])


# Locks and cover letters


def test_a_sent_version_tree_cant_change(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Acme",
                         job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    build_resume(db, account_id, doc)
    sections = tree(client, doc.resume_id)
    base = f"/api/resumes/{doc.resume_id}"
    role_row = sections[2]["entries"][0]["row_id"]
    requests = [
        client.put(f"{base}/sections", json={"section_ids": []}),
        client.put(f"{base}/sections/{sections[0]['row_id']}/items", json={"entries": []}),
        client.put(f"{base}/items/category/{sections[1]['entries'][0]['row_id']}/skills",
                   json={"skill_ids": []}),
        client.put(f"{base}/items/experience/{role_row}/bullets", json={"bullet_ids": []}),
        client.post(f"{base}/sections/{sections[0]['row_id']}/written",
                    json={"kind": "narrative", "content": "New."}),
        client.post(f"{base}/items/experience/{role_row}/written", json={"content": "New."}),
        client.post(f"{base}/sections/written", json={"title": "Talks"}),
    ]
    assert [error(response)[:2] for response in requests] == [(409, "VERSION_LOCKED")] * 7
    assert tree(client, doc.resume_id) == sections


def restoring(sections: list[dict]) -> dict:
    """The body that restores a tree as GET returned it."""
    def entry(placed: dict) -> dict:
        return {"kind": placed["kind"], "item_id": placed["item_id"],
                "skill_ids": [skill["item_id"] for skill in placed["skills"]],
                "bullet_ids": [bullet["item_id"] for bullet in placed["bullets"]]}

    return {"sections": [{"section_id": section["section_id"],
                          "entries": [entry(placed) for placed in section["entries"]]}
                         for section in sections]}


def test_restore_puts_back_a_removed_category_with_its_skills(client: TestClient, db: Session,
                                                              account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    before = tree(client, doc.resume_id)
    base = f"/api/resumes/{doc.resume_id}"
    # Remove the Skills section's category, then the Volunteering section.
    client.put(f"{base}/sections/{before[1]['row_id']}/items", json={"entries": []})
    client.put(f"{base}/sections", json={"section_ids": [s["section_id"] for s in before[:4]]})
    assert shape(tree(client, doc.resume_id)) != shape(before)
    response = client.put(f"{base}/tree", json=restoring(before))
    assert response.status_code == 200
    # Exactly as before: the category with React then TypeScript, not its defaults, and the
    # role's bullets though the role doesn't list them in the library.
    assert shape(response.json()["sections"]) == shape(before)
    assert shape(tree(client, doc.resume_id)) == shape(before)


def test_restore_keeps_what_was_written_in_the_library(client: TestClient, db: Session,
                                                       account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    before = tree(client, doc.resume_id)
    base = f"/api/resumes/{doc.resume_id}"
    client.post(f"{base}/sections/written", json={"title": "Talks"})
    client.put(f"{base}/tree", json=restoring(before))
    assert shape(tree(client, doc.resume_id)) == shape(before)
    assert db.scalar(select(Section.id).where(Section.title == "Talks")) is not None


def test_restore_checks_ids_and_locks(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    before = tree(client, doc.resume_id)
    base = f"/api/resumes/{doc.resume_id}"
    other = add(db, Account())
    theirs = add(db, NarrativeContent(account_id=other.account_id, content="Theirs."))
    body = restoring(before)
    body["sections"][0]["entries"].append({"kind": "narrative", "item_id": theirs.content_id})
    assert error(client.put(f"{base}/tree", json=body))[:2] == (422, "CROSS_ACCOUNT_LINK")
    body = restoring(before)
    body["sections"][0]["entries"].append({"kind": "narrative", "item_id": 999999})
    assert error(client.put(f"{base}/tree", json=body))[:2] == (404, "NOT_FOUND")
    body = restoring(before)
    body["sections"][0]["entries"][0]["skill_ids"] = [skill_id(db, "React")]
    assert error(client.put(f"{base}/tree", json=body))[:2] == (422, "VALIDATION_FAILED")
    body = restoring(before)
    standalone = body["sections"][0]["entries"][2]
    body["sections"][2]["entries"].append(standalone)
    body["sections"][0]["entries"].append({**standalone})
    assert error(client.put(f"{base}/tree", json=body))[0] == 409
    # Nothing changed by the refused requests.
    assert shape(tree(client, doc.resume_id)) == shape(before)
    sent = add(db, Resume(account_id=account_id, name="Acme",
                          job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    assert error(client.put(f"/api/resumes/{sent.resume_id}/tree",
                            json={"sections": []}))[:2] == (409, "VERSION_LOCKED")


def test_cover_letters_build_the_same_way(client: TestClient, db: Session, account_id: int):
    letter = add(db, CoverLetter(account_id=account_id, name="General"))
    intro = add(db, Section(account_id=account_id, title="intro"))
    base = f"/api/cover-letters/{letter.letter_id}"
    sections = client.put(f"{base}/sections", json={"section_ids": [intro.id]}).json()["sections"]
    url = f"{base}/sections/{sections[0]['row_id']}/written"
    client.post(url, json={"kind": "narrative", "content": "I build things."})
    saved = client.post(url, json={"kind": "narrative", "content": "I'd like to build yours."})
    assert saved.json()["output"]["text"] == "I build things. I'd like to build yours."
    assert db.scalars(select(NarrativeContent.content)
                      .join(SectionNarrativeContent)
                      .where(SectionNarrativeContent.section_id == intro.id)
                      .order_by(SectionNarrativeContent.position)).all() == [
        "I build things.", "I'd like to build yours."]
    assert client.put(f"{base}/sections", json={"section_ids": [SKILLS_SECTION_ID]}).json()[
        "output"]["text"] == ""


def test_write_a_new_section_last(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    url = f"/api/resumes/{doc.resume_id}/sections/written"
    saved = client.post(url, json={"title": " Talks "})
    assert saved.status_code == 201
    last = saved.json()["sections"][-1]
    assert (last["title"], last["entries"]) == ("Talks", [])
    assert db.scalar(select(Section.account_id).where(Section.id == last["section_id"])) == (
        account_id)
    # Titles are unique, ignoring capitals, counting the built-in sections.
    assert error(client.post(url, json={"title": "experience"})) == (409, "DUPLICATE", "title")


def test_write_a_new_sign_off_for_a_letter(client: TestClient, db: Session, account_id: int):
    letter = add(db, CoverLetter(account_id=account_id, name="General"))
    url = f"/api/cover-letters/{letter.letter_id}/sign-off/written"
    saved = client.post(url, json={"text": "Warm regards"})
    assert saved.status_code == 201
    new_id = saved.json()["sign_off_id"]
    assert db.scalar(select(SignOff.text).where(SignOff.sign_off_id == new_id)) == "Warm regards"
    # The same text again uses that one.
    assert client.post(url, json={"text": "warm regards"}).json()["sign_off_id"] == new_id
    sent = add(db, CoverLetter(account_id=account_id, name="Acme",
                               job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    assert error(client.post(f"/api/cover-letters/{sent.letter_id}/sign-off/written",
                             json={"text": "Best"}))[:2] == (409, "VERSION_LOCKED")


# The header, one value at a time


def test_header_values_reuse_a_matching_header_or_save_a_new_one(client: TestClient,
                                                                  db: Session, account_id: int):
    original = header(db, account_id)
    doc = add(db, Resume(account_id=account_id, name="Teaching base",
                         header_id=original.header_id))
    url = f"/api/resumes/{doc.resume_id}/header"
    values = {"full_name": "Sam Rivera", "headline": "English Teacher",
              "email": "sam@example.com", "phone": "555-0100", "location": None,
              "linkedin_url": None, "github_url": None, "portfolio_url": None}
    saved = client.put(url, json=values)
    assert saved.status_code == 200
    new_id = saved.json()["header_id"]
    assert new_id != original.header_id
    assert saved.json()["output"]["text"] == (
        "Sam Rivera\nEnglish Teacher\nsam@example.com | 555-0100")
    # The original header isn't changed, and the same values reuse the new one.
    db.refresh(original)
    assert original.headline == "Front-End Engineer"
    again = add(db, Resume(account_id=account_id, name="Other"))
    assert client.put(f"/api/resumes/{again.resume_id}/header",
                      json=values).json()["header_id"] == new_id
    assert client.put(url, json={**values, "headline": "Front-End Engineer",
                                 "github_url": "https://github.com/sam"}).json()[
        "header_id"] == original.header_id
    assert error(client.put(url, json={**values, "full_name": " "}))[:3] == (
        422, "VALIDATION_FAILED", "full_name")


def test_a_sent_versions_header_cant_change(client: TestClient, db: Session, account_id: int):
    letter = add(db, CoverLetter(account_id=account_id, name="Acme",
                                 job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    assert error(client.put(f"/api/cover-letters/{letter.letter_id}/header",
                            json={"full_name": "Sam Rivera"}))[:2] == (409, "VERSION_LOCKED")


def test_write_a_new_role_or_category_in_a_section(client: TestClient, db: Session,
                                                  account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = client.put(f"/api/resumes/{doc.resume_id}/sections",
                      json={"section_ids": [EXPERIENCE_SECTION_ID]}).json()["sections"][0]
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/written"
    saved = client.post(url, json={"kind": "experience", "role_title": "English Teacher",
                                   "organization": "Lincoln High", "dates": "2015 - 2019"})
    assert saved.status_code == 201
    entry = saved.json()["sections"][0]["entries"][0]
    assert (entry["kind"], entry["values"]["organization"]) == ("experience", "Lincoln High")
    assert saved.json()["output"]["text"] == (
        "Experience\nEnglish Teacher | Lincoln High | 2015 - 2019")
    assert db.scalar(select(SectionExperience.section_id)
                     .where(SectionExperience.experience_id == entry["item_id"])) == (
        EXPERIENCE_SECTION_ID)
    assert error(client.post(url, json={"kind": "experience", "role_title": "Tutor"}))[:3] == (
        422, "VALIDATION_FAILED", "organization")

    category(db, account_id, "Teaching")
    assert error(client.post(url, json={"kind": "category", "category_name": "teaching"})) == (
        409, "DUPLICATE", "category_name")
    added = client.post(url, json={"kind": "category", "category_name": "Classroom"}).json()
    assert [e["kind"] for e in added["sections"][0]["entries"]] == ["experience", "category"]


def test_place_a_role_with_the_bullets_chosen_for_it(client: TestClient, db: Session,
                                                    account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = client.put(f"/api/resumes/{doc.resume_id}/sections",
                      json={"section_ids": [EXPERIENCE_SECTION_ID]}).json()["sections"][0]
    teacher = role(db, account_id, ["Taught five classes.", "Ran the debate club.",
                                    "Wrote the curriculum."])
    first, _, third = listed_bullets(db, teacher.experience_id)
    url = f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items"
    placed = client.post(url, json=placing({"kind": "experience",
                                            "item_id": teacher.experience_id,
                                            "bullet_ids": [third, first]}))
    assert placed.status_code == 201
    assert placed.json()["output"]["text"] == (
        "Experience\nEngineer | Acme\n- Wrote the curriculum.\n- Taught five classes.")
    # Placed again: already there.
    assert error(client.post(url, json=placing({"kind": "experience",
                                                "item_id": teacher.experience_id})))[:2] == (
        409, "DUPLICATE")
    # Only the role's own bullets, and only for a kind that shows them.
    other = add(db, BulletPoint(account_id=account_id, content="Not this role's."))
    second_role = role(db, account_id)
    assert error(client.post(url, json=placing({"kind": "experience", "item_id":
                                                second_role.experience_id,
                                                "bullet_ids": [other.bullet_id]}))) == (
        422, "VALIDATION_FAILED", "bullet_ids")
    school = add(db, Education(account_id=account_id, degree="M.Ed.", institution="State"))
    assert error(client.post(url, json=placing({"kind": "education",
                                                "item_id": school.education_id,
                                                "bullet_ids": [first]}))) == (
        422, "VALIDATION_FAILED", "bullet_ids")
    # A refused placement changes nothing.
    assert len(tree(client, doc.resume_id)[0]["entries"]) == 1


def test_place_a_category_with_the_skills_chosen_for_it(client: TestClient, db: Session,
                                                       account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    skills = client.put(f"/api/resumes/{doc.resume_id}/sections",
                        json={"section_ids": [SKILLS_SECTION_ID]}).json()["sections"][0]
    teaching = category(db, account_id, "Teaching", ["Lesson planning", "Grading"])
    placed = client.post(f"/api/resumes/{doc.resume_id}/sections/{skills['row_id']}/items",
                         json=placing({"kind": "category", "item_id": teaching.category_id,
                                       "skill_ids": [skill_id(db, "Grading")]}))
    assert placed.json()["output"]["text"] == "Skills\nTeaching: Grading"


def test_a_new_version_of_a_bullet_takes_its_place(client: TestClient, db: Session,
                                                   account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    work = client.put(f"/api/resumes/{doc.resume_id}/sections",
                      json={"section_ids": [EXPERIENCE_SECTION_ID]}).json()["sections"][0]
    teacher = role(db, account_id, ["Taught five classes.", "Ran the debate club.",
                                    "Wrote the curriculum."])
    first, second, third = listed_bullets(db, teacher.experience_id)
    add(db, SectionBulletPoint(section_id=SUMMARY_SECTION_ID, bullet_id=second, position=1))
    placed = client.post(f"/api/resumes/{doc.resume_id}/sections/{work['row_id']}/items",
                         json=placing({"kind": "experience", "item_id": teacher.experience_id,
                                       "bullet_ids": [first, second]})
                         ).json()["sections"][0]["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/experience/{placed['row_id']}/written"
    saved = client.post(url, json={"content": "Coached the debate team to state.",
                                   "replaces": second})
    assert saved.status_code == 201
    bullets = saved.json()["sections"][0]["entries"][0]["bullets"]
    new = bullets[1]["item_id"]
    # In the original's place here, with the same row.
    assert [(bullet["item_id"], bullet["position"]) for bullet in bullets] == [
        (first, 1), (new, 2)]
    assert bullets[1]["row_id"] == placed["bullets"][1]["row_id"]
    # Listed right after the original wherever it's listed, and the original stays.
    assert listed_bullets(db, teacher.experience_id) == [first, second, new, third]
    assert list(db.scalars(select(SectionBulletPoint.bullet_id)
                           .where(SectionBulletPoint.section_id == SUMMARY_SECTION_ID)
                           .order_by(SectionBulletPoint.position))) == [second, new]
    assert db.get(BulletPoint, second).content == "Ran the debate club."
    # Unchanged text saves nothing, and only a bullet shown here can be replaced.
    assert error(client.post(url, json={"content": " Taught five classes. ",
                                        "replaces": first})) == (
        422, "VALIDATION_FAILED", "content")
    assert error(client.post(url, json={"content": "Other.", "replaces": third}))[:3] == (
        404, "NOT_FOUND", "replaces")
    assert listed_bullets(db, teacher.experience_id) == [first, second, new, third]


def test_a_new_version_of_text_in_a_section_takes_its_place(client: TestClient, db: Session,
                                                            account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    summary = tree(client, doc.resume_id)[0]
    original = summary["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/sections/{summary['row_id']}/written"
    saved = client.post(url, json={"kind": original["kind"], "content": "A new opening line.",
                                   "replaces": original["item_id"]})
    assert saved.status_code == 201
    entries = saved.json()["sections"][0]["entries"]
    assert (entries[0]["row_id"], entries[0]["values"]["content"]) == (
        original["row_id"], "A new opening line.")
    assert len(entries) == len(summary["entries"])
    listed = list(db.scalars(select(SectionNarrativeContent.content_id)
                             .where(SectionNarrativeContent.section_id == SUMMARY_SECTION_ID)
                             .order_by(SectionNarrativeContent.position)))
    # The original isn't listed under the section, so the new version is listed last.
    assert original["item_id"] not in listed
    assert listed[-1] == entries[0]["item_id"]
    assert error(client.post(url, json={"kind": original["kind"],
                                        "content": "A new opening line.",
                                        "replaces": entries[0]["item_id"]}))[:3] == (
        422, "VALIDATION_FAILED", "content")


def test_write_a_skill_under_a_category_or_project(client: TestClient, db: Session,
                                                   account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Teaching base"))
    skills = client.put(f"/api/resumes/{doc.resume_id}/sections",
                        json={"section_ids": [SKILLS_SECTION_ID]}).json()["sections"][0]
    teaching = category(db, account_id, "Teaching", ["Grading"])
    placed = client.post(f"/api/resumes/{doc.resume_id}/sections/{skills['row_id']}/items",
                         json=placing({"kind": "category", "item_id": teaching.category_id})
                         ).json()["sections"][0]["entries"][-1]
    url = f"/api/resumes/{doc.resume_id}/items/category/{placed['row_id']}/skills/written"
    saved = client.post(url, json={"skill_name": " Lesson planning "})
    assert saved.status_code == 201
    shown = saved.json()["sections"][0]["entries"][-1]["skills"]
    assert [skill["text"] for skill in shown] == ["Grading", "Lesson planning"]
    new = skill_id(db, "Lesson planning")
    assert db.scalar(select(SkillCategorySkill.category_id)
                     .where(SkillCategorySkill.skill_id == new)) == teaching.category_id
    # Names are unique, ignoring capitals.
    assert error(client.post(url, json={"skill_name": "grading"}))[:3] == (
        409, "DUPLICATE", "skill_name")

    built = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, built)
    project = tree(client, built.resume_id)[3]["entries"][0]
    url = f"/api/resumes/{built.resume_id}/items/project/{project['row_id']}/skills/written"
    shown = client.post(url, json={"skill_name": "Vite"}).json()[
        "sections"][3]["entries"][0]["skills"]
    assert shown[-1]["text"] == "Vite"
    vite = skill_id(db, "Vite")
    assert db.scalar(select(ProjectSkill.project_id).where(ProjectSkill.skill_id == vite)) == (
        project["item_id"])
    # Every skill has a category: a project's new one is listed under "Other".
    assert db.scalar(select(SkillCategorySkill.category_id)
                     .where(SkillCategorySkill.skill_id == vite)) == OTHER_CATEGORY_ID


# New versions at every level


def test_a_new_version_of_a_section_takes_its_place(client: TestClient, db: Session,
                                                    account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    mine = role(db, account_id)
    add(db, SectionExperience(section_id=EXPERIENCE_SECTION_ID,
                              experience_id=mine.experience_id, position=1))
    # Another account's role is listed under the shared built-in section too.
    other = add(db, Account())
    theirs = add(db, Experience(account_id=other.account_id, role_title="Chef",
                                organization="Diner"))
    add(db, SectionExperience(section_id=EXPERIENCE_SECTION_ID,
                              experience_id=theirs.experience_id, position=2))
    before = tree(client, doc.resume_id)[2]
    url = f"/api/resumes/{doc.resume_id}/sections/{before['row_id']}/version"
    saved = client.post(url, json={"title": "Teaching Experience"})
    assert saved.status_code == 201
    after = saved.json()["sections"][2]
    # The same row and contents, under the new section.
    assert (after["row_id"], after["title"], after["entries"]) == (
        before["row_id"], "Teaching Experience", before["entries"])
    assert after["section_id"] != EXPERIENCE_SECTION_ID
    assert list(db.scalars(select(SectionExperience.experience_id)
                           .where(SectionExperience.section_id == after["section_id"]))) == [
        mine.experience_id]
    assert error(client.post(url, json={"title": "Teaching Experience"})) == (
        422, "VALIDATION_FAILED", "title")
    assert error(client.post(url, json={"title": "summary"}))[:3] == (
        409, "DUPLICATE", "title")


def test_a_new_version_of_a_placed_item_takes_its_place(client: TestClient, db: Session,
                                                        account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    work = tree(client, doc.resume_id)[2]
    placed = work["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/{placed['row_id']}/version"
    values = {"kind": "experience", "role_title": "Senior Engineer", "organization": "Acme",
              "location": None, "dates": "2020 - Present"}
    saved = client.post(url, json=values)
    assert saved.status_code == 201
    entry = saved.json()["sections"][2]["entries"][0]
    # The new role, in the same row, with the same bullets shown under it.
    assert (entry["row_id"], entry["values"]["role_title"], entry["bullets"]) == (
        placed["row_id"], "Senior Engineer", placed["bullets"])
    assert entry["item_id"] != placed["item_id"]
    assert error(client.post(url, json=values)) == (422, "VALIDATION_FAILED", None)
    # The kind must match what's placed in that row.
    assert error(client.post(url, json={**values, "kind": "project", "project_title": "X"}))[
        :2] == (404, "NOT_FOUND")

    school = work["entries"][1]
    url = f"/api/resumes/{doc.resume_id}/items/{school['row_id']}/version"
    saved = client.post(url, json={"kind": "education", "degree": "B.A. in English",
                                   "institution": "State University", "details": None,
                                   "graduation": "May 2015"})
    assert saved.json()["sections"][2]["entries"][1]["values"]["details"] is None

    chosen = tree(client, doc.resume_id)[1]["entries"][0]
    url = f"/api/resumes/{doc.resume_id}/items/{chosen['row_id']}/version"
    assert error(client.post(url, json={"kind": "category", "category_name": "other"}))[:2] == (
        409, "DUPLICATE")
    saved = client.post(url, json={"kind": "category", "category_name": "Web"}).json()
    entry = saved["sections"][1]["entries"][0]
    assert (entry["values"]["category_name"], entry["skills"]) == ("Web", chosen["skills"])


def test_a_new_version_of_a_skill_takes_its_place(client: TestClient, db: Session,
                                                  account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, doc)
    chosen = tree(client, doc.resume_id)[1]["entries"][0]
    react = chosen["skills"][0]
    url = f"/api/resumes/{doc.resume_id}/skills/category/{react['row_id']}/version"
    saved = client.post(url, json={"skill_name": "React 19"})
    assert saved.status_code == 201
    skills = saved.json()["sections"][1]["entries"][0]["skills"]
    assert [(skill["row_id"], skill["text"]) for skill in skills][0] == (
        react["row_id"], "React 19")
    # Listed right after the original under its category.
    listed = list(db.scalars(select(SkillCategorySkill.skill_id)
                             .where(SkillCategorySkill.category_id == chosen["item_id"])
                             .order_by(SkillCategorySkill.position)))
    assert listed[listed.index(react["item_id"]) + 1] == skills[0]["item_id"]
    assert error(client.post(url, json={"skill_name": "React 19"})) == (
        422, "VALIDATION_FAILED", "skill_name")
    assert error(client.post(url, json={"skill_name": "css"}))[:2] == (409, "DUPLICATE")
    # A project's skill, by its row under the project.
    shown = tree(client, doc.resume_id)[3]["entries"][0]["skills"][0]
    url = f"/api/resumes/{doc.resume_id}/skills/project/{shown['row_id']}/version"
    skills = client.post(url, json={"skill_name": "Preact"}).json()[
        "sections"][3]["entries"][0]["skills"]
    assert [skill["text"] for skill in skills] == ["Preact"]
    url = f"/api/resumes/{doc.resume_id}/skills/project/999999/version"
    assert error(client.post(url, json={"skill_name": "Vue"}))[:2] == (404, "NOT_FOUND")
