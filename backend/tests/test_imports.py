"""Starting a resume or cover letter from the user's own file or pasted text (app/imports.py;
docs/FRONTEND_CHECKS.md, "Reading an existing resume or cover letter"), with a stand-in for
Claude."""

import base64
import io
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.claude import get_client
from app.imports import ReadBullet, ReadEntry, ReadHeader, ReadReply, ReadSection, ReadSkill
from app.main import app
from app.models import (
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    Experience,
    ExperienceBulletPoint,
    Header,
    NarrativeContent,
    Resume,
    Section,
    SectionExperience,
    SectionNarrativeContent,
    SectionSkillCategory,
    SignOff,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)
from app.suggestions import Suggestion
from tests.test_documents import SAM, header, posting
from tests.test_experience_projects_bullets import bullet, listed, role
from tests.test_posting_reader import FakeMessages
from tests.test_sections_skills import add, category, error
from tests.test_suggestions import entry, section


class Messages(FakeMessages):
    """With `answer`, which sets the reply from what's saved by then, for a reply that needs
    ids the request itself makes."""

    answer: Callable[[], None] | None = None

    @contextmanager
    def stream(self, **request: Any) -> Iterator[SimpleNamespace]:
        if self.answer is not None:
            self.answer()
        with super().stream(**request) as stream:
            yield stream


@pytest.fixture
def claude(client: TestClient) -> Iterator[Messages]:
    messages = Messages()
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


EMPTY_ENTRY = {field: "" for field in (
    "content", "role_title", "organization", "location", "dates", "project_title", "done_for",
    "url", "category_name", "degree", "institution", "details", "graduation")}


def read_entry(kind: str, *, skills: list[ReadSkill] = (), bullets: list[ReadBullet] = (),
               similar_to: int = 0, **values) -> ReadEntry:
    return ReadEntry(kind=kind, skills=list(skills), bullets=list(bullets),
                     similar_to=similar_to, **(EMPTY_ENTRY | values))


def read_section(title: str, *entries: ReadEntry, similar_to: int = 0) -> ReadSection:
    return ReadSection(title=title, similar_to=similar_to, entries=list(entries))


def reply(*sections: ReadSection, found: bool = True, **letter) -> ReadReply:
    return ReadReply(found=found, header=ReadHeader(**({field: "" for field in (
        "location", "linkedin_url", "portfolio_url")} | SAM)), sections=list(sections),
        **({"addressee": "", "sign_off": "", "signature_name": ""} | letter))


def item(values: dict[str, Any], item_id: int | None = None) -> dict[str, Any]:
    return {"item_id": item_id, "values": values}


def test_reading_matches_each_item_against_the_library(client: TestClient, db: Session,
                                                       account_id: int,
                                                       claude: FakeMessages):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    category(db, account_id, "Front End", ["React"])
    hidden = add(db, Skill(account_id=account_id, skill_name="Vue", hidden=True))
    header(db, account_id)
    claude.reply = reply(
        # Capitals and spacing don't make a different section, category, or skill.
        read_section("skills", read_entry("category", category_name="front  end", skills=[
            ReadSkill(skill_name="react", similar_to=0),
            # Claude's similar item must be an offered one of the same kind.
            ReadSkill(skill_name="Vue.js", similar_to=hidden.skill_id),
            ReadSkill(skill_name="JS", similar_to=99999)])),
        read_section("Work Experience", read_entry(
            "experience", similar_to=job.experience_id,
            **{"role_title": "Engineer", "organization": "Acme Corp", "dates": "2020 – 2022"},
            bullets=[ReadBullet(content="Shipped  it", similar_to=0),
                     ReadBullet(content="Tested it", similar_to=0)]),
            similar_to=EXPERIENCE_SECTION_ID),
        # Empty text is left out.
        read_section("Summary", read_entry("narrative", content=" ")))
    response = client.post("/api/resumes/read", json={"text": "Sam Rivera\nEngineer, Acme"})
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["header"]["full_name"] == "Sam Rivera" and body["header_saved"] is True
    skills, experience, summary = body["sections"]
    assert (skills["saved"], experience["saved"]) == (True, False)
    assert experience["similar"] == {"id": EXPERIENCE_SECTION_ID, "name": "Experience"}
    [front_end] = skills["entries"]
    assert front_end["saved"] is True
    assert [(s["values"]["skill_name"], s["saved"], s["similar"]) for s in front_end["skills"]] == [
        ("react", True, None), ("Vue.js", False, None), ("JS", False, None)]
    [placed] = experience["entries"]
    assert placed["saved"] is False
    assert placed["similar"] == {"id": job.experience_id, "name": "Engineer, Acme (2020 – 2022)"}
    assert [b["saved"] for b in placed["bullets"]] == [True, False]
    assert summary["entries"] == []
    # The text goes to Claude as data, after the cached library.
    [call] = claude.calls
    assert "<document>\nSam Rivera" in call["messages"][0]["content"]
    assert "cache_control" in call["system"][1] and "Front End" in call["system"][1]["text"]
    # Nothing is saved.
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(BulletPoint)) == 1


def test_reading_a_file(client: TestClient, db: Session, account_id: int,
                        claude: FakeMessages):
    claude.reply = reply(read_section("Summary", read_entry("narrative", content="I build.")))
    pdf = base64.b64encode(b"%PDF-1.7 resume").decode()
    response = client.post("/api/resumes/read", json={"file": {"name": "Me.PDF", "data": pdf}})
    assert response.status_code == 200, response.json()
    document, ask = claude.calls[0]["messages"][0]["content"]
    assert document["source"] == {"type": "base64", "media_type": "application/pdf",
                                  "data": pdf}
    assert ask["text"] == "Read this resume."

    # A Word file goes to Claude as its text, one paragraph per line.
    word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xml = (f'<w:document xmlns:w="{word}"><w:body>'
           "<w:p><w:r><w:t>Sam</w:t></w:r><w:r><w:t xml:space='preserve'> Rivera</w:t></w:r></w:p>"
           "<w:p><w:r><w:t>Engineer</w:t><w:tab/><w:t>2020</w:t></w:r></w:p>"
           "</w:body></w:document>")
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("word/document.xml", xml)
    docx = base64.b64encode(data.getvalue()).decode()
    client.post("/api/cover-letters/read", json={"file": {"name": "me.docx", "data": docx}})
    content = claude.calls[1]["messages"][0]["content"]
    assert content == "Read this cover letter.\n<document>\nSam Rivera\nEngineer\t2020\n</document>"


def test_reading_refuses_what_it_cant_read(client: TestClient, claude: FakeMessages):
    data = base64.b64encode(b"hello").decode()
    for body, field in (({}, "text"),
                        ({"file": {"name": "me.doc", "data": data}}, "file"),
                        ({"file": {"name": "me.docx", "data": data}}, "file"),
                        ({"file": {"name": "me.pdf", "data": "not base64!"}}, "file")):
        assert error(client.post("/api/resumes/read", json=body)) == (
            422, "VALIDATION_FAILED", field)
    claude.reply = reply(found=False)
    assert error(client.post("/api/resumes/read", json={"text": "A recipe"})) == (
        422, "VALIDATION_FAILED", "text")


def test_saving_reuses_the_library_and_adds_the_rest(client: TestClient, db: Session,
                                                     account_id: int):
    job = role(db, account_id, ["Shipped it"], section_id=EXPERIENCE_SECTION_ID)
    front_end = category(db, account_id, "Front End", ["React"])
    saved_header = header(db, account_id)
    response = client.post("/api/resumes/imported", json={
        "name": "Imported", "header": SAM, "sections": [
            item({"title": "Summary"}) | {"entries": [
                item({"content": "I build tools."}) | {"kind": "narrative"}]},
            item({"title": "skills"}) | {"entries": [
                item({"category_name": "Front End"}) | {"kind": "category", "skills": [
                    item({"skill_name": "React"}), item({"skill_name": "CSS"}),
                    item({"skill_name": "css"})]},
                item({"category_name": "Other"}) | {"kind": "category", "skills": [
                    item({"skill_name": "Git"})]}]},
            # The user chose the saved role over the one Claude read ("Use the saved one").
            item({"title": "Volunteering"}) | {"entries": [
                item({"role_title": "Ignored", "organization": "Ignored"}, job.experience_id)
                | {"kind": "experience", "bullets": [
                    item({"content": "Shipped it"}), item({"content": "Mentored."})]},
                # Twice in one section is once.
                item({"content": "Mentored."}) | {"kind": "bullet"}]},
        ]})
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["header_id"] == saved_header.header_id
    summary, skills, volunteering = body["sections"]
    assert [(s["title"], s["section_id"]) for s in body["sections"]] == [
        ("Summary", SUMMARY_SECTION_ID), ("Skills", SKILLS_SECTION_ID),
        ("Volunteering", volunteering["section_id"])]
    assert [[c["text"] for c in e["skills"]] for e in skills["entries"]] == [
        ["React", "CSS"], ["Git"]]
    assert skills["entries"][1]["item_id"] == OTHER_CATEGORY_ID
    [placed] = volunteering["entries"]
    assert placed["item_id"] == job.experience_id
    assert [b["text"] for b in placed["bullets"]] == ["Shipped it", "Mentored."]

    db.expire_all()
    # Each new item is listed under its parent, last.
    mentored = bullet(db, account_id, "Mentored.").bullet_id
    assert listed(db, ExperienceBulletPoint, "experience_id", job.experience_id,
                  "bullet_id")[-1] == mentored
    assert listed(db, SectionExperience, "section_id", volunteering["section_id"],
                  "experience_id") == [job.experience_id]
    sentence = db.scalar(select(NarrativeContent.content_id).where(
        NarrativeContent.content == "I build tools."))
    assert listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID,
                  "content_id") == [sentence]
    assert listed(db, SkillCategorySkill, "category_id", front_end.category_id, "skill_id")[-1] \
        == db.scalar(select(Skill.skill_id).where(Skill.skill_name == "CSS"))
    # "Other" isn't listed under a section.
    assert listed(db, SectionSkillCategory, "section_id", SKILLS_SECTION_ID,
                  "category_id") == [front_end.category_id]
    assert db.scalar(select(func.count()).select_from(Experience)) == 1
    assert db.scalar(select(func.count()).select_from(Header)) == 1
    assert db.scalar(select(func.count()).select_from(Skill)) == 3


def test_saving_checks_each_item(client: TestClient, db: Session, account_id: int):
    other = add(db, Section(account_id=add(db, Account()).account_id, title="Theirs"))
    for sections, field in (
        ([item({"title": "Experience"}) | {"entries": [
            item({"role_title": " ", "organization": "Acme"}) | {"kind": "experience"}]}],
         "role_title"),
        ([item({"title": "x" * 101})], "title"),
        ([item({}, other.id)], "item_id"),
    ):
        response = client.post("/api/resumes/imported", json={"name": "Bad", "header": SAM,
                                                              "sections": sections})
        assert error(response) in ((422, "VALIDATION_FAILED", field),
                                   (422, "CROSS_ACCOUNT_LINK", field)), response.json()
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Resume)) == 0
    assert db.scalar(select(func.count()).select_from(Header)) == 0


def test_a_postings_letter_from_a_file(client: TestClient, db: Session, account_id: int):
    job = posting(db, account_id, False)
    job.header_id = header(db, account_id).header_id
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    db.flush()
    response = client.post("/api/cover-letters/imported", json={
        "name": "Engineer at Acme", "job_posting_id": job.job_posting_id,
        # A posting's letter uses the posting's header.
        "header": SAM | {"full_name": "Someone Else"},
        "addressee": "Ms. Lee", "sign_off": item({"text": "sincerely"}),
        "signature_name": "Sam", "sections": [
            item({"title": "Intro"}) | {"entries": [
                item({"content": "I'd like to join."}) | {"kind": "narrative"}]}]})
    assert response.status_code == 201, response.json()
    body = response.json()
    assert (body["header_id"], body["addressee"], body["sign_off_id"],
            body["signature_name"]) == (job.header_id, "Ms. Lee", sincerely.sign_off_id, "Sam")
    assert [s["title"] for s in body["sections"]] == ["Intro"]
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Header)) == 1
    # Left out, the greeting and sign-off are the usual ones.
    second = posting(db, account_id, False)
    second.header_id = job.header_id
    db.flush()
    body = client.post("/api/cover-letters/imported", json={
        "name": "Again", "job_posting_id": second.job_posting_id, "sections": []}).json()
    assert (body["addressee"], body["sign_off_id"]) == ("Acme Hiring Team",
                                                        sincerely.sign_off_id)


def test_claude_tailors_it_from_there(client: TestClient, db: Session, account_id: int,
                                      claude: Messages):
    job = posting(db, account_id, False)
    job.header_id = header(db, account_id).header_id
    db.flush()
    body = {"name": "Engineer at Acme", "job_posting_id": job.job_posting_id, "sections": [
        item({"title": "Summary"}) | {"entries": [
            item({"content": "I build tools."}) | {"kind": "narrative"}]}]}
    # Claude starts from the document itself, so it isn't based on another one.
    def answer() -> None:
        doc_id = db.scalar(select(Resume.resume_id).where(Resume.name == "Engineer at Acme"))
        sentence = db.scalar(select(NarrativeContent.content_id))
        claude.reply = Suggestion(starting_document_id=doc_id, starting_reason="Yours.",
                                  sections=[section(SUMMARY_SECTION_ID, entry(
                                      "narrative", sentence, new_text="I build React tools."))])

    claude.answer = answer
    response = client.post("/api/resumes/imported/tailored", json=body)
    assert response.status_code == 201, response.json()
    doc = response.json()
    assert [s["title"] for s in doc["sections"]] == ["Summary"]
    assert doc["draft"]["starting_document"] is None
    assert doc["draft"]["starting_reason"] == "Yours."
    assert [text["text"] for text in doc["draft"]["texts"]] == ["I build React tools."]
    [call] = claude.calls
    assert f"with id {doc['resume_id']}" in call["messages"][0]["content"]
    assert f'"id": {doc["resume_id"]}' in call["system"][1]["text"]

    # Only for a posting, and if Claude fails, nothing is saved.
    assert error(client.post("/api/resumes/imported/tailored", json=body | {
        "job_posting_id": None})) == (422, "VALIDATION_FAILED", "job_posting_id")
    other = posting(db, account_id, False)
    other.header_id = job.header_id
    db.flush()
    claude.answer = None
    claude.reply = anthropic.APIConnectionError(
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
    assert error(client.post("/api/resumes/imported/tailored", json=body | {
        "job_posting_id": other.job_posting_id}))[:2] == (503, "AI_UNAVAILABLE")
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Resume)) == 1
    assert db.scalar(select(func.count()).select_from(CoverLetter)) == 0
    assert db.scalar(select(func.count()).select_from(SkillCategory).where(
        SkillCategory.account_id == account_id)) == 0
