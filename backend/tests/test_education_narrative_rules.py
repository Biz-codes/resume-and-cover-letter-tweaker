"""Education, narrative content, writing rules, tone sets, and sign-offs (docs/FRONTEND_CHECKS.md:
"Delete warnings", "Sent versions are locked", "Suggesting and adding items")."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EDUCATION_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    CoverLetter,
    CoverLetterNarrativeContent,
    CoverLetterSection,
    Education,
    JobPosting,
    NarrativeContent,
    Resume,
    ResumeEducation,
    ResumeSection,
    Section,
    SectionEducation,
    SectionNarrativeContent,
    SignOff,
    ToneRule,
    ToneSet,
    WritingRule,
    WritingRuleKind,
)
from tests.test_experience_projects_bullets import listed
from tests.test_sections_skills import add, error, resume

DEGREE = {"degree": "B.A. in English", "institution": "State University",
          "graduation": "May 2015"}


def entry(db: Session, account_id: int, section_id: int | None = EDUCATION_SECTION_ID,
          **values) -> Education:
    row = add(db, Education(account_id=account_id, **{**DEGREE, **values}))
    if section_id is not None:
        add(db, SectionEducation(section_id=section_id, education_id=row.education_id,
                                 position=row.education_id))
    return row


def show_education(db: Session, doc: Resume, row: Education) -> int:
    section = add(db, ResumeSection(resume_id=doc.resume_id, section_id=EDUCATION_SECTION_ID,
                                    position=1))
    return add(db, ResumeEducation(resume_section_id=section.resume_section_id,
                                   education_id=row.education_id, position=1)).resume_education_id


def narrative(db: Session, account_id: int, content: str,
              section_id: int | None = SUMMARY_SECTION_ID) -> NarrativeContent:
    row = add(db, NarrativeContent(account_id=account_id, content=content))
    if section_id is not None:
        add(db, SectionNarrativeContent(section_id=section_id, content_id=row.content_id,
                                        position=row.content_id))
    return row


def letter(db: Session, account_id: int, name: str, sent: bool, **values) -> CoverLetter:
    posting = add(db, JobPosting(account_id=account_id, url="https://example.com",
                                 organization="Acme", role_title="Engineer",
                                 description="Build things.",
                                 applied_on=date(2026, 10, 1) if sent else None))
    return add(db, CoverLetter(account_id=account_id, name=name,
                               job_posting_id=posting.job_posting_id, **values))


# Education


def test_new_education_is_listed_under_education_by_default(client: TestClient,
                                                            account_id: int):
    created = client.post("/api/education", json={**DEGREE, "details": "  "})
    assert created.status_code == 201
    body = created.json()
    assert (body["degree"], body["details"]) == ("B.A. in English", None)
    assert body["sections"] == [{"id": EDUCATION_SECTION_ID, "title": "Education"}]
    unlisted = client.post("/api/education", json={**DEGREE, "section_id": None}).json()
    assert unlisted["sections"] == []


def test_education_needs_a_degree_and_institution(client: TestClient, account_id: int):
    response = client.post("/api/education", json={**DEGREE, "institution": " "})
    assert error(response) == (422, "VALIDATION_FAILED", "institution")


def test_another_accounts_education_is_not_found(client: TestClient, db: Session,
                                                 account_id: int):
    theirs = entry(db, add(db, Account()).account_id, section_id=None)
    assert error(client.get(f"/api/education/{theirs.education_id}"))[1] == "NOT_FOUND"


def test_edit_education_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    row = entry(db, account_id)
    show_education(db, resume(db, account_id, "Draft", sent=False), row)
    saved = client.put(f"/api/education/{row.education_id}",
                       json={**DEGREE, "graduation": "2015"}).json()
    assert (saved["education_id"], saved["graduation"]) == (row.education_id, "2015")
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]


def test_edit_education_a_sent_version_uses_saves_a_new_entry(client: TestClient, db: Session,
                                                              account_id: int):
    row = entry(db, account_id)
    later = entry(db, account_id, degree="M.A. in English")
    sent = resume(db, account_id, "Sent", sent=True)
    draft = resume(db, account_id, "Draft", sent=False)
    sent_choice = show_education(db, sent, row)
    draft_choice = show_education(db, draft, row)

    saved = client.put(f"/api/education/{row.education_id}",
                       json={**DEGREE, "graduation": "2015"}).json()
    new_id = saved["education_id"]
    assert new_id != row.education_id
    assert listed(db, SectionEducation, "section_id", EDUCATION_SECTION_ID, "education_id") \
        == [row.education_id, new_id, later.education_id]
    db.expire_all()
    assert db.get(Education, row.education_id).graduation == "May 2015"
    assert db.get(ResumeEducation, sent_choice).education_id == row.education_id
    assert db.get(ResumeEducation, draft_choice).education_id == new_id


def test_delete_education_removes_it_from_resumes(client: TestClient, db: Session,
                                                  account_id: int):
    row = entry(db, account_id)
    chosen = show_education(db, resume(db, account_id, "Draft", sent=False), row)
    assert client.delete(f"/api/education/{row.education_id}").status_code == 204
    assert db.get(ResumeEducation, chosen) is None
    assert listed(db, SectionEducation, "section_id", EDUCATION_SECTION_ID, "education_id") == []


# Narrative content


def test_new_narrative_is_listed_under_the_sections_chosen(client: TestClient, db: Session,
                                                           account_id: int):
    intro = add(db, Section(account_id=account_id, title="Intro"))
    created = client.post("/api/narrative-content", json={
        "content": " I build tools. ", "section_ids": [SUMMARY_SECTION_ID, intro.id]})
    assert created.status_code == 201
    body = created.json()
    assert body["content"] == "I build tools."
    assert body["sections"] == [{"id": SUMMARY_SECTION_ID, "title": "Summary"},
                                {"id": intro.id, "title": "Intro"}]
    unlisted = client.post("/api/narrative-content", json={"content": "Loose."}).json()
    assert unlisted["sections"] == []
    assert error(client.post("/api/narrative-content", json={"content": " "})) == \
        (422, "VALIDATION_FAILED", "content")
    assert error(client.post("/api/narrative-content",
                             json={"content": "Hi.", "section_ids": [999]})) == \
        (404, "NOT_FOUND", "section_ids")
    theirs = add(db, Section(account_id=add(db, Account()).account_id, title="Theirs"))
    assert error(client.post("/api/narrative-content",
                             json={"content": "Hi.", "section_ids": [theirs.id]}))[1] == \
        "CROSS_ACCOUNT_LINK"


def test_edit_narrative_a_sent_letter_uses_saves_a_new_excerpt(client: TestClient, db: Session,
                                                                account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    closing = narrative(db, account_id, "Thank you.")
    choices = {}
    for name, sent in (("Sent", True), ("Draft", False)):
        doc = letter(db, account_id, name, sent)
        section = add(db, CoverLetterSection(letter_id=doc.letter_id,
                                             section_id=SUMMARY_SECTION_ID, position=1))
        choices[name] = add(db, CoverLetterNarrativeContent(
            cover_letter_section_id=section.cover_letter_section_id,
            content_id=intro.content_id, position=1)).cover_letter_narrative_content_id

    saved = client.put(f"/api/narrative-content/{intro.content_id}",
                       json={"content": "I build small tools."}).json()
    new_id = saved["content_id"]
    assert new_id != intro.content_id
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]
    assert listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID, "content_id") \
        == [intro.content_id, new_id, closing.content_id]
    db.expire_all()
    assert db.get(NarrativeContent, intro.content_id).content == "I build tools."
    assert db.get(CoverLetterNarrativeContent, choices["Sent"]).content_id == intro.content_id
    assert db.get(CoverLetterNarrativeContent, choices["Draft"]).content_id == new_id


def test_edit_narrative_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    saved = client.put(f"/api/narrative-content/{intro.content_id}",
                       json={"content": "I build tools!"}).json()
    assert (saved["content_id"], saved["content"]) == (intro.content_id, "I build tools!")


def test_edit_narrative_sections(client: TestClient, db: Session, account_id: int):
    """Sections are kept in place, dropped, or added last, without making a new excerpt."""
    other = add(db, Section(account_id=account_id, title="Intro"))
    first = narrative(db, account_id, "First.")
    intro = narrative(db, account_id, "I build tools.")
    last = narrative(db, account_id, "Last.")
    add(db, SectionNarrativeContent(section_id=other.id, content_id=first.content_id,
                                    position=1))
    saved = client.put(f"/api/narrative-content/{intro.content_id}",
                       json={"content": "I build tools.", "section_ids": [other.id]}).json()
    assert saved["content_id"] == intro.content_id
    assert [section["id"] for section in saved["sections"]] == [other.id]
    assert listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID, "content_id") \
        == [first.content_id, last.content_id]
    assert listed(db, SectionNarrativeContent, "section_id", other.id, "content_id") \
        == [first.content_id, intro.content_id]
    # Without section_ids, the sections stay as they are.
    saved = client.put(f"/api/narrative-content/{intro.content_id}",
                       json={"content": "I build tools!"}).json()
    assert [section["id"] for section in saved["sections"]] == [other.id]


def test_locked_edit_lists_only_the_new_excerpt_under_new_sections(client: TestClient,
                                                                   db: Session, account_id: int):
    other = add(db, Section(account_id=account_id, title="Intro"))
    intro = narrative(db, account_id, "I build tools.")
    doc = letter(db, account_id, "Sent", True)
    section = add(db, CoverLetterSection(letter_id=doc.letter_id, section_id=SUMMARY_SECTION_ID,
                                         position=1))
    add(db, CoverLetterNarrativeContent(cover_letter_section_id=section.cover_letter_section_id,
                                        content_id=intro.content_id, position=1))
    saved = client.put(f"/api/narrative-content/{intro.content_id}",
                       json={"content": "I build small tools.",
                             "section_ids": [other.id]}).json()
    assert saved["content_id"] != intro.content_id
    assert [section["id"] for section in saved["sections"]] == [other.id]
    assert listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID, "content_id") \
        == [intro.content_id]


def test_delete_narrative(client: TestClient, db: Session, account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    assert client.delete(f"/api/narrative-content/{intro.content_id}").status_code == 204
    assert listed(db, SectionNarrativeContent, "section_id", SUMMARY_SECTION_ID, "content_id") \
        == []


# Section lists


def test_section_lists_narrative_and_education_in_order(client: TestClient, db: Session,
                                                        account_id: int):
    first = narrative(db, account_id, "First.", section_id=None).content_id
    second = narrative(db, account_id, "Second.", section_id=None).content_id
    response = client.put(f"/api/sections/{SUMMARY_SECTION_ID}/narrative-content",
                          json={"content_ids": [second, first]})
    assert [s["content"] for s in response.json()["narrative_content"]] == ["Second.", "First."]
    row = entry(db, account_id, section_id=None)
    response = client.put(f"/api/sections/{SUMMARY_SECTION_ID}/education",
                          json={"education_ids": [row.education_id]})
    assert response.json()["education"] == [{"education_id": row.education_id, **{
        key: DEGREE[key] for key in ("degree", "institution", "graduation")}}]
    theirs = narrative(db, add(db, Account()).account_id, "Theirs.", section_id=None)
    response = client.put(f"/api/sections/{SUMMARY_SECTION_ID}/narrative-content",
                          json={"content_ids": [theirs.content_id]})
    assert error(response)[1] == "CROSS_ACCOUNT_LINK"


# Writing rules


def test_writing_rules_list_terms_then_patterns(client: TestClient, db: Session,
                                                account_id: int):
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.pattern,
                        rule_text="lists of three"))
    add(db, WritingRule(account_id=account_id, kind=WritingRuleKind.term, rule_text="leverage"))
    rules = client.get("/api/writing-rules").json()
    assert [(rule["kind"], rule["rule_text"], rule["active"]) for rule in rules] == [
        ("term", "leverage", True), ("pattern", "lists of three", True)]


def test_add_switch_off_and_delete_a_writing_rule(client: TestClient, db: Session,
                                                  account_id: int):
    created = client.post("/api/writing-rules", json={"kind": "term", "rule_text": " synergy "})
    assert created.status_code == 201
    rule = created.json()
    assert (rule["rule_text"], rule["active"]) == ("synergy", True)
    url = f"/api/writing-rules/{rule['writing_rule_id']}"
    saved = client.put(url, json={"kind": "term", "rule_text": "synergy", "active": False}).json()
    assert saved["active"] is False
    assert client.delete(url).status_code == 204
    assert db.get(WritingRule, rule["writing_rule_id"]) is None


def test_writing_rule_errors(client: TestClient, db: Session, account_id: int):
    response = client.post("/api/writing-rules", json={"kind": "word", "rule_text": "synergy"})
    assert error(response) == (422, "VALIDATION_FAILED", "kind")
    response = client.post("/api/writing-rules", json={"kind": "term", "rule_text": ""})
    assert error(response) == (422, "VALIDATION_FAILED", "rule_text")
    theirs = add(db, WritingRule(account_id=add(db, Account()).account_id,
                                 kind=WritingRuleKind.term, rule_text="theirs"))
    assert error(client.get(f"/api/writing-rules/{theirs.writing_rule_id}"))[1] == "NOT_FOUND"


# Tone sets


def test_tone_set_rules_are_added_ordered_edited_and_deleted(client: TestClient,
                                                             account_id: int):
    tone_set = client.post("/api/tone-sets", json={"name": "Tech"}).json()
    url = f"/api/tone-sets/{tone_set['tone_set_id']}"
    client.post(f"{url}/rules", json={"rule_text": "Lead with tools."})
    body = client.post(f"{url}/rules", json={"rule_text": "Use metrics."}).json()
    first, second = (rule["tone_rule_id"] for rule in body["rules"])
    body = client.put(f"{url}/rules", json={"tone_rule_ids": [second, first]}).json()
    assert [rule["rule_text"] for rule in body["rules"]] == ["Use metrics.", "Lead with tools."]
    body = client.put(f"{url}/rules/{first}", json={"rule_text": "Name the tools."}).json()
    assert [rule["rule_text"] for rule in body["rules"]] == ["Use metrics.", "Name the tools."]
    body = client.delete(f"{url}/rules/{second}").json()
    assert [rule["rule_text"] for rule in body["rules"]] == ["Name the tools."]
    assert client.put(url, json={"name": "Engineering"}).json()["name"] == "Engineering"


def test_tone_rule_order_must_hold_every_rule_once(client: TestClient, db: Session,
                                                   account_id: int):
    mine = add(db, ToneSet(account_id=account_id, name="Tech"))
    other = add(db, ToneSet(account_id=account_id, name="Teaching"))
    rule = add(db, ToneRule(tone_set_id=mine.tone_set_id, rule_text="Lead with tools.",
                            position=1))
    foreign = add(db, ToneRule(tone_set_id=other.tone_set_id, rule_text="Students first.",
                               position=1))
    url = f"/api/tone-sets/{mine.tone_set_id}/rules"
    for ids in ([], [rule.tone_rule_id, rule.tone_rule_id], [foreign.tone_rule_id]):
        assert error(client.put(url, json={"tone_rule_ids": ids})) == \
            (422, "VALIDATION_FAILED", "tone_rule_ids")
    response = client.put(f"{url}/{foreign.tone_rule_id}", json={"rule_text": "Mine now."})
    assert error(response)[1] == "NOT_FOUND"


def test_delete_tone_set_deletes_its_rules_and_keeps_resumes(client: TestClient, db: Session,
                                                             account_id: int):
    tone_set = add(db, ToneSet(account_id=account_id, name="Tech"))
    rule_id = add(db, ToneRule(tone_set_id=tone_set.tone_set_id, rule_text="Lead with tools.",
                               position=1)).tone_rule_id
    doc = resume(db, account_id, "Sent", sent=True)
    doc.tone_set_id = tone_set.tone_set_id
    db.flush()
    used_by = client.get(f"/api/tone-sets/{tone_set.tone_set_id}").json()["used_by"]
    assert used_by == [{"kind": "resume", "id": doc.resume_id, "name": "Sent", "locked": True}]
    assert client.delete(f"/api/tone-sets/{tone_set.tone_set_id}").status_code == 204
    db.expire_all()
    assert db.scalar(select(ToneRule).where(ToneRule.tone_rule_id == rule_id)) is None
    assert db.get(Resume, doc.resume_id).tone_set_id is None


# Sign-offs


def test_edit_sign_off_a_sent_letter_uses_saves_a_new_one(client: TestClient, db: Session,
                                                          account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    sent = letter(db, account_id, "Sent", sent=True, sign_off_id=sincerely.sign_off_id)
    draft = letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    saved = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                       json={"text": "Best regards"}).json()
    assert saved["sign_off_id"] != sincerely.sign_off_id
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]
    db.expire_all()
    assert db.get(SignOff, sincerely.sign_off_id).text == "Sincerely"
    assert db.get(CoverLetter, sent.letter_id).sign_off_id == sincerely.sign_off_id
    assert db.get(CoverLetter, draft.letter_id).sign_off_id == saved["sign_off_id"]


def test_edit_sign_off_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    saved = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                       json={"text": "Best regards"}).json()
    assert (saved["sign_off_id"], saved["text"]) == (sincerely.sign_off_id, "Best regards")


def test_delete_sign_off_leaves_letters_with_no_closing(client: TestClient, db: Session,
                                                        account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    draft = letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    assert client.delete(f"/api/sign-offs/{sincerely.sign_off_id}").status_code == 204
    db.expire_all()
    assert db.get(CoverLetter, draft.letter_id).sign_off_id is None
    assert error(client.post("/api/sign-offs", json={"text": ""})) == \
        (422, "VALIDATION_FAILED", "text")
    assert db.scalar(select(SignOff).where(SignOff.account_id == account_id)) is None
