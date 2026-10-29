"""Resumes and cover letters: reading them as plain text, base versions, copies, and locks
(docs/APP_FLOW.md, "Output"; docs/FRONTEND_CHECKS.md, "Versions" and "Sent versions are
locked")."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.documents import COVER_LETTER, RESUME, load_tree
from app.models import (
    EXPERIENCE_SECTION_ID,
    PROJECTS_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    CoverLetterNarrativeContent,
    CoverLetterSection,
    Education,
    Experience,
    Header,
    JobPosting,
    NarrativeContent,
    Project,
    Resume,
    ResumeBulletPoint,
    ResumeEducation,
    ResumeExperience,
    ResumeNarrativeContent,
    ResumeProject,
    ResumeProjectSkill,
    ResumeSection,
    ResumeSkill,
    ResumeSkillCategory,
    Section,
    SignOff,
    ToneSet,
)
from tests.test_sections_skills import add, category, error, skill_id

SAM = {"full_name": "Sam Rivera", "headline": "Front-End Engineer", "email": "sam@example.com",
       "phone": "555-0100", "github_url": "https://github.com/sam"}


def header(db: Session, account_id: int, **values) -> Header:
    return add(db, Header(account_id=account_id, **(SAM | values)))


def posting(db: Session, account_id: int, sent: bool) -> JobPosting:
    return add(db, JobPosting(account_id=account_id, url="https://example.com/job",
                              organization="Acme", role_title="Engineer",
                              description="Build things.",
                              applied_on=date(2026, 10, 1) if sent else None))


def place(db: Session, doc: Resume, section_id: int, position: int) -> int:
    return add(db, ResumeSection(resume_id=doc.resume_id, section_id=section_id,
                                 position=position)).resume_section_id


def build_resume(db: Session, account_id: int, doc: Resume) -> None:
    """Every kind of entry, placed out of id order to check positions."""
    summary = place(db, doc, SUMMARY_SECTION_ID, 1)
    for position, text in ((2, "Builds accessible apps."), (1, "Engineer with 4 years.")):
        content = add(db, NarrativeContent(account_id=account_id, content=text))
        add(db, ResumeNarrativeContent(resume_section_id=summary, content_id=content.content_id,
                                       position=position))
    standalone = add(db, BulletPoint(account_id=account_id, content="Speaks at meetups."))
    add(db, ResumeBulletPoint(resume_section_id=summary, bullet_id=standalone.bullet_id,
                              position=3))

    skills = place(db, doc, SKILLS_SECTION_ID, 2)
    front = category(db, account_id, "Front End", ["TypeScript", "React", "CSS"])
    chosen = add(db, ResumeSkillCategory(resume_section_id=skills,
                                         category_id=front.category_id, position=1))
    for position, name in ((2, "TypeScript"), (1, "React")):
        add(db, ResumeSkill(resume_skill_category_id=chosen.resume_skill_category_id,
                            skill_id=skill_id(db, name), position=position))

    work = place(db, doc, EXPERIENCE_SECTION_ID, 3)
    role = add(db, Experience(account_id=account_id, role_title="Engineer",
                              organization="Acme", dates="2020 - Present"))
    role_row = add(db, ResumeExperience(resume_section_id=work,
                                        experience_id=role.experience_id, position=1))
    for position, text in ((2, "Cut load time in half."), (1, "Led the redesign.")):
        bullet = add(db, BulletPoint(account_id=account_id, content=text))
        add(db, ResumeBulletPoint(resume_section_id=work, bullet_id=bullet.bullet_id,
                                  resume_experience_id=role_row.resume_experience_id,
                                  position=position))
    school = add(db, Education(account_id=account_id, degree="B.A. in English",
                               institution="State University", details="Minor in CS",
                               graduation="May 2015"))
    add(db, ResumeEducation(resume_section_id=work, education_id=school.education_id,
                            position=2))

    projects = place(db, doc, PROJECTS_SECTION_ID, 4)
    project = add(db, Project(account_id=account_id, project_title="Tweaker",
                              url="https://example.com/tweaker"))
    project_row = add(db, ResumeProject(resume_section_id=projects,
                                        project_id=project.project_id, position=1))
    add(db, ResumeProjectSkill(resume_project_id=project_row.resume_project_id,
                               skill_id=skill_id(db, "React"), position=1))
    bullet = add(db, BulletPoint(account_id=account_id, content="Built it with Claude."))
    add(db, ResumeBulletPoint(resume_section_id=projects, bullet_id=bullet.bullet_id,
                              resume_project_id=project_row.resume_project_id, position=1))

    empty = add(db, Section(account_id=account_id, title="Volunteering"))
    place(db, doc, empty.id, 5)


RESUME_TEXT = """\
Sam Rivera
Front-End Engineer
sam@example.com | 555-0100 | https://github.com/sam

Summary
Engineer with 4 years. Builds accessible apps.
- Speaks at meetups.

Skills
Front End: React, TypeScript

Experience
Engineer | Acme | 2020 - Present
- Led the redesign.
- Cut load time in half.
B.A. in English | State University | May 2015
Minor in CS

Projects
Tweaker
Skills: React
- Built it with Claude.

Volunteering"""


# Reading


def test_a_resume_reads_as_plain_text_in_parts(client: TestClient, db: Session,
                                                account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base",
                         header_id=header(db, account_id).header_id))
    build_resume(db, account_id, doc)
    output = client.get(f"/api/resumes/{doc.resume_id}").json()["output"]
    assert output["text"] == RESUME_TEXT
    assert [part["label"] for part in output["parts"]] == [
        "Header", "Summary", "Skills", "Experience", "Projects", "Volunteering"]
    assert output["parts"][2]["text"] == "Skills\nFront End: React, TypeScript"


def test_a_cover_letter_reads_without_section_titles(client: TestClient, db: Session,
                                                     account_id: int):
    sign_off = add(db, SignOff(account_id=account_id, text="Best regards"))
    letter = add(db, CoverLetter(account_id=account_id, name="Acme letter", addressee="Ms. Lee",
                                 header_id=header(db, account_id).header_id,
                                 sign_off_id=sign_off.sign_off_id))
    for position, (title, texts) in enumerate((("intro", ["I build things.", "Hire me."]),
                                               ("outro", ["Thank you."])), start=1):
        section = add(db, Section(account_id=account_id, title=title))
        row = add(db, CoverLetterSection(letter_id=letter.letter_id, section_id=section.id,
                                         position=position))
        for index, text in enumerate(texts, start=1):
            content = add(db, NarrativeContent(account_id=account_id, content=text))
            add(db, CoverLetterNarrativeContent(
                cover_letter_section_id=row.cover_letter_section_id,
                content_id=content.content_id, position=index))
    url = f"/api/cover-letters/{letter.letter_id}"
    output = client.get(url).json()["output"]
    assert output["text"].split("\n\n")[1:] == [
        "Dear Ms. Lee,", "I build things. Hire me.", "Thank you.", "Best regards,\nSam Rivera"]
    assert [part["label"] for part in output["parts"]] == [
        "Header", "Greeting", "intro", "outro", "Sign-off"]

    letter.signature_name = "Samuel Rivera"
    db.flush()
    assert client.get(url).json()["output"]["text"].endswith("Best regards,\nSamuel Rivera")
    letter.sign_off_id = letter.addressee = letter.header_id = None
    db.flush()
    assert client.get(url).json()["output"]["text"] == "I build things. Hire me.\n\nThank you."


def test_list_shows_postings_locks_and_copies(client: TestClient, db: Session, account_id: int):
    base = add(db, Resume(account_id=account_id, name="Tech base"))
    sent = add(db, Resume(account_id=account_id, name="Acme", based_on_resume_id=base.resume_id,
                          job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    listed = {doc["name"]: doc for doc in client.get("/api/resumes").json()}
    assert listed["Tech base"]["job_posting"] is None
    assert not listed["Tech base"]["locked"]
    assert listed["Tech base"]["copies"] == [
        {"kind": "resume", "id": sent.resume_id, "name": "Acme", "locked": True}]
    assert listed["Acme"]["job_posting"]["organization"] == "Acme"
    assert listed["Acme"]["locked"]
    assert listed["Acme"]["based_on"] == {"id": base.resume_id, "name": "Tech base"}


def test_another_accounts_documents_are_not_found(client: TestClient, db: Session,
                                                  account_id: int):
    other = add(db, Account())
    resume = add(db, Resume(account_id=other.account_id, name="Theirs"))
    letter = add(db, CoverLetter(account_id=other.account_id, name="Theirs"))
    assert client.get("/api/resumes").json() == []
    for url in (f"/api/resumes/{resume.resume_id}", f"/api/cover-letters/{letter.letter_id}"):
        assert error(client.get(url))[:2] == (404, "NOT_FOUND")
        assert error(client.post(f"{url}/copies", json={"name": "Mine"}))[:2] == (404,
                                                                                  "NOT_FOUND")
        assert error(client.delete(url))[:2] == (404, "NOT_FOUND")


# Creating


def test_new_resume_starts_with_the_most_recently_used_header(client: TestClient, db: Session,
                                                              account_id: int):
    older = header(db, account_id, headline="Teacher")
    newer = header(db, account_id)
    add(db, CoverLetter(account_id=account_id, name="Letter", header_id=older.header_id))
    created = client.post("/api/resumes", json={"name": " Teaching base "})
    assert created.status_code == 201
    assert created.json()["name"] == "Teaching base"
    assert created.json()["header_id"] == older.header_id
    assert created.json()["output"] == {"parts": [{"label": "Header", "text": (
        "Sam Rivera\nTeacher\nsam@example.com | 555-0100 | https://github.com/sam")}],
        "text": "Sam Rivera\nTeacher\nsam@example.com | 555-0100 | https://github.com/sam"}
    chosen = client.post("/api/resumes", json={"name": "B", "header_id": newer.header_id})
    assert chosen.json()["header_id"] == newer.header_id
    assert client.post("/api/resumes", json={"name": "C", "header_id": None}).json()[
        "header_id"] is None


def test_new_cover_letter_defaults(client: TestClient, db: Session, account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    letter = client.post("/api/cover-letters", json={"name": "General"}).json()
    assert (letter["addressee"], letter["sign_off_id"], letter["header_id"]) == (
        "Hiring Team", sincerely.sign_off_id, None)
    assert letter["output"]["text"] == "Dear Hiring Team,\n\nSincerely,"
    chosen = client.post("/api/cover-letters", json={"name": "Plain", "addressee": " ",
                                                     "sign_off_id": None}).json()
    assert (chosen["addressee"], chosen["sign_off_id"]) == (None, None)


def test_links_must_be_the_accounts_own(client: TestClient, db: Session, account_id: int):
    other = add(db, Account())
    theirs = add(db, ToneSet(account_id=other.account_id, name="Theirs"))
    assert error(client.post("/api/resumes", json={"name": "A", "tone_set_id": theirs.tone_set_id})
                 ) == (422, "CROSS_ACCOUNT_LINK", "tone_set_id")
    assert error(client.post("/api/cover-letters", json={"name": "A", "sign_off_id": 999999})
                 ) == (404, "NOT_FOUND", "sign_off_id")
    assert error(client.post("/api/resumes", json={"name": " "}))[:3] == (
        422, "VALIDATION_FAILED", "name")


# Editing


def test_edit_a_base_resume_in_place(client: TestClient, db: Session, account_id: int):
    doc = add(db, Resume(account_id=account_id, name="Tech base"))
    tone = add(db, ToneSet(account_id=account_id, name="Tech"))
    saved = client.put(f"/api/resumes/{doc.resume_id}",
                       json={"name": "Tech", "header_id": None, "tone_set_id": tone.tone_set_id})
    assert saved.status_code == 200
    assert (saved.json()["resume_id"], saved.json()["name"], saved.json()["tone_set_id"]) == (
        doc.resume_id, "Tech", tone.tone_set_id)


def test_a_sent_version_can_only_be_renamed(client: TestClient, db: Session, account_id: int):
    sent_posting = posting(db, account_id, sent=True)
    letter = add(db, CoverLetter(account_id=account_id, name="Acme",
                                 job_posting_id=sent_posting.job_posting_id, addressee="Ms. Lee"))
    url = f"/api/cover-letters/{letter.letter_id}"
    fields = {"header_id": None, "tone_set_id": None, "addressee": "Ms. Lee", "sign_off_id": None,
              "signature_name": None}
    assert client.put(url, json={"name": "Acme (sent)", **fields}).json()["name"] == "Acme (sent)"
    assert error(client.put(url, json={"name": "Acme", **fields, "addressee": "Hiring Team"})
                 )[:2] == (409, "VERSION_LOCKED")
    db.refresh(letter)
    assert (letter.name, letter.addressee) == ("Acme (sent)", "Ms. Lee")


# Copying and deleting


def test_copy_duplicates_the_whole_tree_as_a_new_base(client: TestClient, db: Session,
                                                      account_id: int):
    tone = add(db, ToneSet(account_id=account_id, name="Tech"))
    sent = add(db, Resume(account_id=account_id, name="Acme", tone_set_id=tone.tone_set_id,
                          header_id=header(db, account_id).header_id,
                          job_posting_id=posting(db, account_id, sent=True).job_posting_id))
    build_resume(db, account_id, sent)
    copied = client.post(f"/api/resumes/{sent.resume_id}/copies", json={"name": "Acme base"})
    assert copied.status_code == 201
    copy = copied.json()
    assert copy["output"]["text"] == RESUME_TEXT
    assert (copy["job_posting"], copy["locked"], copy["tone_set_id"], copy["based_on"]) == (
        None, False, tone.tone_set_id, {"id": sent.resume_id, "name": "Acme"})

    original, duplicate = (load_tree(db, RESUME, doc_id)
                           for doc_id in (sent.resume_id, copy["resume_id"]))
    assert [(s.section_id, [(e.kind, e.item_id, e.position, [b.item_id for b in e.bullets],
                             [k.item_id for k in e.skills]) for e in s.entries])
            for s in original] == [
        (s.section_id, [(e.kind, e.item_id, e.position, [b.item_id for b in e.bullets],
                         [k.item_id for k in e.skills]) for e in s.entries])
        for s in duplicate]
    assert not {s.row_id for s in original} & {s.row_id for s in duplicate}
    # The original keeps its own rows: 4 bullets, none moved to the copy.
    assert db.scalar(select(func.count()).select_from(ResumeBulletPoint).join(ResumeSection)
                     .where(ResumeSection.resume_id == sent.resume_id)) == 4


def test_copy_a_cover_letter_keeps_its_fields(client: TestClient, db: Session, account_id: int):
    letter = add(db, CoverLetter(account_id=account_id, name="General", addressee="Ms. Lee",
                                 signature_name="Samuel"))
    copy = client.post(f"/api/cover-letters/{letter.letter_id}/copies",
                       json={"name": "General 2"}).json()
    assert (copy["name"], copy["addressee"], copy["signature_name"]) == (
        "General 2", "Ms. Lee", "Samuel")
    assert load_tree(db, COVER_LETTER, copy["letter_id"]) == []


def test_delete_keeps_the_copies(client: TestClient, db: Session, account_id: int):
    base = add(db, Resume(account_id=account_id, name="Tech base"))
    build_resume(db, account_id, base)
    copy = client.post(f"/api/resumes/{base.resume_id}/copies", json={"name": "Copy"}).json()
    assert client.delete(f"/api/resumes/{base.resume_id}").status_code == 204
    kept = client.get(f"/api/resumes/{copy['resume_id']}").json()
    assert kept["based_on"] is None
    assert kept["output"]["text"] == RESUME_TEXT.split("\n\n", 1)[1]
