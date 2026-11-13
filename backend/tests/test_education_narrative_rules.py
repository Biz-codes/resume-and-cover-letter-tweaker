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
from app.tones import find_or_add_rule, set_rules
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


def test_edit_education_in_place_when_every_one_in_progress_gets_it(client: TestClient,
                                                                    db: Session, account_id: int):
    row = entry(db, account_id)
    draft = resume(db, account_id, "Draft", sent=False)
    show_education(db, draft, row)
    saved = client.put(f"/api/education/{row.education_id}",
                       json={**DEGREE, "graduation": "2015",
                             "apply_to": [{"kind": "resume", "id": draft.resume_id}]}).json()
    assert (saved["education_id"], saved["graduation"]) == (row.education_id, "2015")
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]


def test_edit_education_a_sent_version_uses_saves_a_new_entry(client: TestClient, db: Session,
                                                              account_id: int):
    row = entry(db, account_id)
    later = entry(db, account_id, degree="M.A. in English")
    sent = resume(db, account_id, "Sent", sent=True)
    draft = resume(db, account_id, "Draft", sent=False)
    other = resume(db, account_id, "Other draft", sent=False)
    sent_choice = show_education(db, sent, row)
    draft_choice = show_education(db, draft, row)
    other_choice = show_education(db, other, row)

    saved = client.put(f"/api/education/{row.education_id}",
                       json={**DEGREE, "graduation": "2015",
                             "apply_to": [{"kind": "resume", "id": draft.resume_id}]}).json()
    new_id = saved["education_id"]
    assert new_id != row.education_id
    assert listed(db, SectionEducation, "section_id", EDUCATION_SECTION_ID, "education_id") \
        == [row.education_id, new_id, later.education_id]
    db.expire_all()
    assert db.get(Education, row.education_id).graduation == "May 2015"
    assert db.get(ResumeEducation, sent_choice).education_id == row.education_id
    assert db.get(ResumeEducation, draft_choice).education_id == new_id
    # Unchecked, it keeps the original.
    assert db.get(ResumeEducation, other_choice).education_id == row.education_id


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


def show_excerpt(db: Session, doc: CoverLetter, excerpt: NarrativeContent) -> int:
    section = add(db, CoverLetterSection(letter_id=doc.letter_id, section_id=SUMMARY_SECTION_ID,
                                         position=1))
    return add(db, CoverLetterNarrativeContent(
        cover_letter_section_id=section.cover_letter_section_id,
        content_id=excerpt.content_id, position=1)).cover_letter_narrative_content_id


def picked_letters(*docs: CoverLetter) -> list[dict]:
    return [{"kind": "cover_letter", "id": doc.letter_id} for doc in docs]


def change_excerpt(client: TestClient, excerpt: NarrativeContent, content: str,
                   apply: list[dict]) -> dict:
    return client.put(f"/api/narrative-content/{excerpt.content_id}",
                      json={"content": content, "apply_to": apply}).json()


def test_edit_narrative_a_sent_letter_uses_saves_a_new_excerpt(client: TestClient, db: Session,
                                                                account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    closing = narrative(db, account_id, "Thank you.")
    sent, draft = letter(db, account_id, "Sent", True), letter(db, account_id, "Draft", False)
    choices = {doc.name: show_excerpt(db, doc, intro) for doc in (sent, draft)}

    # Every one in progress is picked, but a sent letter uses it, so it's a new excerpt.
    saved = change_excerpt(client, intro, "I build small tools.", picked_letters(draft))
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
    saved = change_excerpt(client, intro, "I build tools!", [])
    assert (saved["content_id"], saved["content"]) == (intro.content_id, "I build tools!")


def test_edit_narrative_picking_every_one_in_progress_edits_in_place(client: TestClient,
                                                                     db: Session,
                                                                     account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    docs = [letter(db, account_id, name, False) for name in ("First", "Second")]
    for doc in docs:
        show_excerpt(db, doc, intro)
    saved = change_excerpt(client, intro, "I build tools!", picked_letters(*docs))
    assert (saved["content_id"], saved["content"]) == (intro.content_id, "I build tools!")


def test_edit_narrative_switches_only_the_picked_letters(client: TestClient, db: Session,
                                                         account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    first, second = (letter(db, account_id, name, False) for name in ("First", "Second"))
    first_row, second_row = (show_excerpt(db, doc, intro) for doc in (first, second))
    saved = change_excerpt(client, intro, "I build tools!", picked_letters(first))
    assert saved["content_id"] != intro.content_id
    db.expire_all()
    assert db.get(CoverLetterNarrativeContent, first_row).content_id == saved["content_id"]
    assert db.get(CoverLetterNarrativeContent, second_row).content_id == intro.content_id
    assert db.get(NarrativeContent, intro.content_id).content == "I build tools."


def test_edit_narrative_picking_none_keeps_every_one_on_the_original(client: TestClient,
                                                                    db: Session,
                                                                    account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    row = show_excerpt(db, letter(db, account_id, "Draft", False), intro)
    saved = change_excerpt(client, intro, "I build tools!", [])
    assert (saved["content_id"] != intro.content_id, saved["used_by"]) == (True, [])
    db.expire_all()
    assert db.get(CoverLetterNarrativeContent, row).content_id == intro.content_id


def test_edit_narrative_refuses_picking_what_isnt_in_progress(client: TestClient, db: Session,
                                                              account_id: int):
    intro = narrative(db, account_id, "I build tools.")
    sent = letter(db, account_id, "Sent", True)
    show_excerpt(db, sent, intro)
    unrelated = letter(db, account_id, "Unrelated", False)
    for doc in (sent, unrelated):
        response = client.put(f"/api/narrative-content/{intro.content_id}",
                              json={"content": "I build tools!",
                                    "apply_to": picked_letters(doc)})
        assert error(response) == (422, "VALIDATION_FAILED", "apply_to")
    db.expire_all()
    assert db.get(NarrativeContent, intro.content_id).content == "I build tools."


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


# Tones and tone rules


def tone(db: Session, account_id: int, name: str, rules: list[str]) -> ToneSet:
    """A tone listing these rules, each the account's saved rule with that text or a new one."""
    tone_set = add(db, ToneSet(account_id=account_id, name=name))
    set_rules(db, tone_set.tone_set_id,
              [find_or_add_rule(db, account_id, text).tone_rule_id for text in rules])
    return tone_set


def rule_texts(body: dict) -> list[str]:
    return [rule["rule_text"] for rule in body["rules"]]


def rule_id(db: Session, account_id: int, text: str) -> int:
    return find_or_add_rule(db, account_id, text).tone_rule_id


def uses(db: Session, tone_set: ToneSet, *docs) -> None:
    for doc in docs:
        doc.tone_set_id = tone_set.tone_set_id
    db.flush()


def test_a_tone_is_saved_whole_in_place_when_nothing_sent_uses_it(client: TestClient,
                                                                  db: Session, account_id: int):
    tone_set = client.post("/api/tone-sets", json={"name": "Tech"}).json()
    url = f"/api/tone-sets/{tone_set['tone_set_id']}"
    body = client.put(url, json={"name": "Tech", "rules": [
        {"rule_text": "Lead with tools."}, {"rule_text": "Use metrics."}]}).json()
    assert body["tone_set_id"] == tone_set["tone_set_id"]
    assert rule_texts(body) == ["Lead with tools.", "Use metrics."]
    first, second = (rule["tone_rule_id"] for rule in body["rules"])
    # Reordered, one taken out, one added, and renamed, in one save.
    body = client.put(url, json={"name": "Engineering", "rules": [
        {"tone_rule_id": second}, {"rule_text": "Keep it short."}]}).json()
    assert (body["tone_set_id"], body["name"]) == (tone_set["tone_set_id"], "Engineering")
    assert rule_texts(body) == ["Use metrics.", "Keep it short."]
    assert body["rules"][0]["tone_rule_id"] == second
    # The rule taken out stays in the library.
    assert client.get(f"/api/tone-rules/{first}").json()["tones"] == []


def test_a_rule_with_the_same_text_is_reused(client: TestClient, db: Session, account_id: int):
    tech = tone(db, account_id, "Tech", ["Lead with tools."])
    saved = rule_id(db, account_id, "Lead with tools.")
    db.get(ToneRule, saved).hidden = True
    db.flush()
    teaching = add(db, ToneSet(account_id=account_id, name="Teaching"))
    # Written again in another tone, ignoring spacing and capitals: the same rule, hidden or not.
    body = client.put(f"/api/tone-sets/{teaching.tone_set_id}", json={
        "name": "Teaching", "rules": [{"rule_text": "  lead with   TOOLS. "}]}).json()
    assert [rule["tone_rule_id"] for rule in body["rules"]] == [saved]
    assert rule_texts(body) == ["Lead with tools."]
    # And added on its own.
    response = client.post("/api/tone-rules", json={"rule_text": "LEAD WITH TOOLS."})
    assert response.json()["tone_rule_id"] == saved
    tones = client.get(f"/api/tone-rules/{saved}").json()["tones"]
    assert [one["tone_set_id"] for one in tones] == [teaching.tone_set_id, tech.tone_set_id]
    new = client.post("/api/tone-rules", json={"rule_text": "Use metrics."}).json()
    assert (new["rule_text"], new["tones"], new["hidden"]) == ("Use metrics.", [], False)


def test_a_tones_rules_are_checked(client: TestClient, db: Session, account_id: int):
    mine = tone(db, account_id, "Tech", ["Lead with tools."])
    listed = rule_id(db, account_id, "Lead with tools.")
    hidden = add(db, ToneRule(account_id=account_id, rule_text="Hidden.", hidden=True))
    other_account = add(db, Account()).account_id
    foreign = add(db, ToneRule(account_id=other_account, rule_text="Theirs."))
    url = f"/api/tone-sets/{mine.tone_set_id}"

    def save(*rules: dict):
        return client.put(url, json={"name": "Tech", "rules": list(rules)})

    assert error(save({"tone_rule_id": listed}, {"tone_rule_id": listed})) == (
        409, "DUPLICATE", "rules")
    # New text matching a rule already in the list is that rule too.
    assert error(save({"tone_rule_id": listed}, {"rule_text": "lead with tools."})) == (
        409, "DUPLICATE", "rules")
    assert error(save({"tone_rule_id": foreign.tone_rule_id})) == (
        422, "CROSS_ACCOUNT_LINK", "rules")
    assert error(save({"tone_rule_id": 999999})) == (404, "NOT_FOUND", "rules")
    assert error(save({"tone_rule_id": hidden.tone_rule_id})) == (
        422, "VALIDATION_FAILED", "rules")
    assert error(save({"tone_rule_id": listed, "rule_text": "Both."}))[:2] == (
        422, "VALIDATION_FAILED")
    # A hidden rule the tone already lists stays.
    db.get(ToneRule, listed).hidden = True
    db.flush()
    assert save({"tone_rule_id": listed}).status_code == 200


def test_editing_a_tone_a_sent_resume_uses_saves_a_new_one(client: TestClient, db: Session,
                                                           account_id: int):
    original = tone(db, account_id, "Tech", ["Lead with tools."])
    sent = resume(db, account_id, "Sent", sent=True)
    draft = resume(db, account_id, "Draft", sent=False)
    other = resume(db, account_id, "Other draft", sent=False)
    uses(db, original, sent, draft, other)
    url = f"/api/tone-sets/{original.tone_set_id}"
    change = {"name": "Tech", "rules": [{"rule_text": "Lead with metrics."}],
              "apply_to": [{"kind": "resume", "id": draft.resume_id}]}
    # The earlier version needs a new name, since tone names are unique.
    assert error(client.put(url, json=change)) == (422, "VALIDATION_FAILED", "earlier_name")
    assert error(client.put(url, json={**change, "earlier_name": "tech"})) == (
        409, "DUPLICATE", "earlier_name")
    add(db, ToneSet(account_id=account_id, name="Teaching"))
    assert error(client.put(url, json={**change, "earlier_name": "Teaching"})) == (
        409, "DUPLICATE", "earlier_name")

    saved = client.put(url, json={**change, "earlier_name": "Tech (earlier)"}).json()
    # The new one takes the name, and the original keeps its rules under the earlier name.
    assert (saved["name"], rule_texts(saved)) == ("Tech", ["Lead with metrics."])
    assert saved["tone_set_id"] != original.tone_set_id
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]
    earlier = client.get(url).json()
    assert (earlier["name"], rule_texts(earlier)) == ("Tech (earlier)", ["Lead with tools."])
    db.expire_all()
    assert db.get(Resume, sent.resume_id).tone_set_id == original.tone_set_id
    assert db.get(Resume, other.resume_id).tone_set_id == original.tone_set_id
    # Only one in progress that uses it can be picked.
    response = client.put(url, json={"name": "Tech (earlier)", "rules": [],
                                     "apply_to": [{"kind": "resume", "id": sent.resume_id}]})
    assert error(response) == (422, "VALIDATION_FAILED", "apply_to")


def test_editing_a_tone_unchecked_saves_a_new_one_nothing_uses(client: TestClient, db: Session,
                                                               account_id: int):
    original = tone(db, account_id, "Tech", ["Lead with tools."])
    draft = resume(db, account_id, "Draft", sent=False)
    uses(db, original, draft)
    saved = client.put(f"/api/tone-sets/{original.tone_set_id}",
                       json={"name": "Tech", "rules": [], "earlier_name": "Tech 2025"}).json()
    assert (saved["name"], saved["rules"], saved["used_by"]) == ("Tech", [], [])
    db.expire_all()
    assert db.get(Resume, draft.resume_id).tone_set_id == original.tone_set_id
    assert db.get(ToneSet, original.tone_set_id).name == "Tech 2025"


def test_tone_names_are_unique_ignoring_capitals(client: TestClient, db: Session,
                                                 account_id: int):
    tech = add(db, ToneSet(account_id=account_id, name="Tech"))
    teaching = add(db, ToneSet(account_id=account_id, name="Teaching"))
    response = client.post("/api/tone-sets", json={"name": "tech"})
    assert error(response) == (409, "DUPLICATE", "name")
    assert response.json()["error"]["message"] == 'There\'s already a tone named "Tech".'
    response = client.put(f"/api/tone-sets/{teaching.tone_set_id}",
                          json={"name": "TECH", "rules": []})
    assert error(response) == (409, "DUPLICATE", "name")
    response = client.put(f"/api/tone-sets/{tech.tone_set_id}", json={"name": "TECH", "rules": []})
    assert response.json()["name"] == "TECH"


def test_deleting_a_tone_keeps_its_rules_and_resumes(client: TestClient, db: Session,
                                                     account_id: int):
    tone_set = tone(db, account_id, "Tech", ["Lead with tools."])
    rule = rule_id(db, account_id, "Lead with tools.")
    doc = resume(db, account_id, "Draft", sent=False)
    uses(db, tone_set, doc)
    used_by = client.get(f"/api/tone-sets/{tone_set.tone_set_id}").json()["used_by"]
    assert used_by == [{"kind": "resume", "id": doc.resume_id, "name": "Draft", "locked": False}]
    assert client.delete(f"/api/tone-sets/{tone_set.tone_set_id}").status_code == 204
    db.expire_all()
    assert db.get(ToneRule, rule) is not None
    assert db.get(Resume, doc.resume_id).tone_set_id is None


def test_a_rule_is_edited_in_place_when_nothing_sent_uses_it(client: TestClient, db: Session,
                                                             account_id: int):
    tech = tone(db, account_id, "Tech", ["Lead with tools.", "Use metrics."])
    draft = resume(db, account_id, "Draft", sent=False)
    uses(db, tech, draft)
    rule = rule_id(db, account_id, "Lead with tools.")
    body = client.put(f"/api/tone-rules/{rule}", json={
        "rule_text": "Lead with the tools.",
        "apply_to": [{"kind": "resume", "id": draft.resume_id}]}).json()
    assert body["tone_rule_id"] == rule
    assert [(one["name"], [use["name"] for use in one["used_by"]]) for one in body["tones"]] == [
        ("Tech", ["Draft"])]
    assert [use["name"] for use in body["used_by"]] == ["Draft"]
    assert rule_texts(client.get(f"/api/tone-sets/{tech.tone_set_id}").json()) == [
        "Lead with the tools.", "Use metrics."]
    # Matching another rule's text is refused.
    response = client.put(f"/api/tone-rules/{rule}", json={"rule_text": "use METRICS."})
    assert error(response) == (409, "DUPLICATE", "rule_text")


def test_editing_a_rule_a_sent_resume_uses_reaches_each_tone_by_its_own_uses(
        client: TestClient, db: Session, account_id: int):
    rules = ["Lead with tools.", "Use metrics."]
    shared = tone(db, account_id, "Tech", rules)       # used by a sent one and a picked one
    unused = tone(db, account_id, "Spare", rules)      # used by nothing
    picked_only = tone(db, account_id, "Short", rules)  # used only by a picked one
    kept = tone(db, account_id, "Long", rules)         # used only by one not picked
    sent = resume(db, account_id, "Sent", sent=True)
    draft = resume(db, account_id, "Draft", sent=False)
    short = resume(db, account_id, "Short draft", sent=False)
    long = resume(db, account_id, "Long draft", sent=False)
    uses(db, shared, sent, draft)
    uses(db, picked_only, short)
    uses(db, kept, long)
    rule = rule_id(db, account_id, "Lead with tools.")
    change = {"rule_text": "Lead with the tools.", "apply_to": [
        {"kind": "resume", "id": draft.resume_id}, {"kind": "resume", "id": short.resume_id}]}
    url = f"/api/tone-rules/{rule}"
    # The shared tone is saved as a new one, so its original needs a new name.
    assert error(client.put(url, json=change)) == (422, "VALIDATION_FAILED", "earlier_names")
    body = client.put(url, json={**change,
                                 "earlier_names": {str(shared.tone_set_id): "Tech (sent)"}}).json()
    new_rule = body["tone_rule_id"]
    assert new_rule != rule and body["rule_text"] == "Lead with the tools."

    def tone_rules(tone_set_id: int) -> list[int]:
        return [one["tone_rule_id"]
                for one in client.get(f"/api/tone-sets/{tone_set_id}").json()["rules"]]

    metrics = rule_id(db, account_id, "Use metrics.")
    # In the original's place where nothing else uses the tone; the original where no picked one
    # does.
    assert tone_rules(unused.tone_set_id) == [new_rule, metrics]
    assert tone_rules(picked_only.tone_set_id) == [new_rule, metrics]
    assert tone_rules(kept.tone_set_id) == [rule, metrics]
    # The shared tone keeps the original under its earlier name; the picked one gets a new tone.
    db.expire_all()
    assert db.get(ToneSet, shared.tone_set_id).name == "Tech (sent)"
    assert tone_rules(shared.tone_set_id) == [rule, metrics]
    assert db.get(Resume, sent.resume_id).tone_set_id == shared.tone_set_id
    switched = db.get(Resume, draft.resume_id).tone_set_id
    assert switched != shared.tone_set_id
    assert db.get(ToneSet, switched).name == "Tech"
    assert tone_rules(switched) == [new_rule, metrics]
    assert db.get(Resume, short.resume_id).tone_set_id == picked_only.tone_set_id


def test_deleting_a_rule_takes_it_out_of_every_tone(client: TestClient, db: Session,
                                                    account_id: int):
    tech = tone(db, account_id, "Tech", ["Lead with tools.", "Use metrics."])
    rule = rule_id(db, account_id, "Lead with tools.")
    sent = resume(db, account_id, "Sent", sent=True)
    uses(db, tech, sent)
    assert error(client.delete(f"/api/tone-rules/{rule}"))[:2] == (409, "VERSION_LOCKED")
    hidden = client.put(f"/api/tone-rules/{rule}/hidden", json={"hidden": True}).json()
    assert hidden["hidden"] is True
    sent.tone_set_id = None
    db.flush()
    assert client.delete(f"/api/tone-rules/{rule}").status_code == 204
    assert rule_texts(client.get(f"/api/tone-sets/{tech.tone_set_id}").json()) == ["Use metrics."]
    other = add(db, ToneRule(account_id=add(db, Account()).account_id, rule_text="Theirs."))
    assert error(client.get(f"/api/tone-rules/{other.tone_rule_id}"))[:2] == (404, "NOT_FOUND")


# Sign-offs


def test_edit_sign_off_a_sent_letter_uses_saves_a_new_one(client: TestClient, db: Session,
                                                          account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    sent = letter(db, account_id, "Sent", sent=True, sign_off_id=sincerely.sign_off_id)
    draft = letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    other = letter(db, account_id, "Other draft", sent=False, sign_off_id=sincerely.sign_off_id)
    saved = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                       json={"text": "Best regards",
                             "apply_to": [{"kind": "cover_letter", "id": draft.letter_id}]}).json()
    assert saved["sign_off_id"] != sincerely.sign_off_id
    assert [use["name"] for use in saved["used_by"]] == ["Draft"]
    db.expire_all()
    assert db.get(SignOff, sincerely.sign_off_id).text == "Sincerely"
    assert db.get(CoverLetter, sent.letter_id).sign_off_id == sincerely.sign_off_id
    assert db.get(CoverLetter, draft.letter_id).sign_off_id == saved["sign_off_id"]
    assert db.get(CoverLetter, other.letter_id).sign_off_id == sincerely.sign_off_id


def test_edit_sign_off_unchecked_saves_a_new_one_nothing_uses(client: TestClient, db: Session,
                                                              account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    draft = letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    saved = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                       json={"text": "Best regards"}).json()
    assert (saved["text"], saved["used_by"]) == ("Best regards", [])
    db.expire_all()
    assert db.get(CoverLetter, draft.letter_id).sign_off_id == sincerely.sign_off_id
    # Only one in progress that uses it can be picked.
    response = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                          json={"text": "Warmly", "apply_to": [{"kind": "resume", "id": 1}]})
    assert error(response) == (422, "VALIDATION_FAILED", "apply_to")


def test_edit_sign_off_in_place_when_unsent(client: TestClient, db: Session, account_id: int):
    sincerely = add(db, SignOff(account_id=account_id, text="Sincerely"))
    draft = letter(db, account_id, "Draft", sent=False, sign_off_id=sincerely.sign_off_id)
    saved = client.put(f"/api/sign-offs/{sincerely.sign_off_id}",
                       json={"text": "Best regards",
                             "apply_to": [{"kind": "cover_letter", "id": draft.letter_id}]}).json()
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
