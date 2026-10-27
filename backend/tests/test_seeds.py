"""The committed seed SQL: db/seed_defaults.sql and the helpers in db/seed_helpers.sql.

Uses made-up data only; the personal seed files are never read here.
"""

import pytest
from sqlalchemy import Connection, func, select, text
from sqlalchemy.exc import DBAPIError

from app.config import BACKEND_DIR
from app.models import (
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    CoverLetterBulletPoint,
    Experience,
    ExperienceBulletPoint,
    Resume,
    ResumeBulletPoint,
    ResumeExperience,
    Section,
    SectionBulletPoint,
    SectionExperience,
    SectionSkillCategory,
    SignOff,
    WritingRule,
)

DB_DIR = BACKEND_DIR.parent / "db"
BULLETS = ["Built the thing.", "Tested the thing."]


def run_sql_file(connection: Connection, name: str) -> None:
    # The raw driver cursor with no parameters runs the whole file as written (SQLAlchemy
    # would treat the %I in format() calls as parameter placeholders).
    connection.connection.cursor().execute((DB_DIR / name).read_text())


def scalar(connection: Connection, statement):
    return connection.execute(statement).scalar()


def call(connection: Connection, sql: str, **params):
    return connection.execute(text(sql), params).scalar()


@pytest.fixture
def account(connection: Connection) -> int:
    return connection.execute(Account.__table__.insert().returning(Account.account_id)).scalar()


@pytest.fixture
def helpers(connection: Connection, account: int) -> Connection:
    run_sql_file(connection, "seed_helpers.sql")
    return connection


def new_doc(connection: Connection, account: int, model, name: str) -> None:
    connection.execute(model.__table__.insert().values(account_id=account, name=name))


def add_job(connection: Connection, doc: str, doc_name: str, dates: str, bullets=BULLETS) -> int:
    section = call(connection, "SELECT pg_temp.doc_section(:doc, :name, :sec, 1)",
                   doc=doc, name=doc_name, sec=EXPERIENCE_SECTION_ID)
    return call(connection,
                "SELECT pg_temp.add_job(:doc, :section, 1, 'Engineer', 'Acme', 'Remote', :dates,"
                " CAST(:bullets AS text[]))",
                doc=doc, section=section, dates=dates, bullets=bullets)


# db/seed_defaults.sql


def test_defaults_add_rules_and_sign_off_once(connection: Connection, account: int):
    run_sql_file(connection, "seed_defaults.sql")
    rules = scalar(connection, select(func.count()).select_from(WritingRule))
    assert rules > 0
    assert scalar(connection, select(SignOff.text)) == "Sincerely"

    run_sql_file(connection, "seed_defaults.sql")
    assert scalar(connection, select(func.count()).select_from(WritingRule)) == rules
    assert scalar(connection, select(func.count()).select_from(SignOff)) == 1


def test_defaults_never_bring_back_a_deleted_rule(connection: Connection, account: int):
    run_sql_file(connection, "seed_defaults.sql")
    connection.execute(WritingRule.__table__.delete().where(WritingRule.rule_text == "synergy"))
    run_sql_file(connection, "seed_defaults.sql")
    assert scalar(connection, select(func.count()).where(WritingRule.rule_text == "synergy")) == 0


# db/seed_helpers.sql


def test_a_second_resume_reuses_the_job_and_bullets(helpers: Connection, account: int):
    new_doc(helpers, account, Resume, "First")
    new_doc(helpers, account, Resume, "Second")
    first = add_job(helpers, "resume", "First", "2020 - 2023")
    second = add_job(helpers, "resume", "Second", "2020 - 2023")

    assert first == second
    assert scalar(helpers, select(func.count()).select_from(Experience)) == 1
    assert scalar(helpers, select(func.count()).select_from(BulletPoint)) == len(BULLETS)
    assert helpers.execute(
        select(ExperienceBulletPoint.position).order_by(ExperienceBulletPoint.position)
    ).scalars().all() == [1, 2]
    assert scalar(helpers, select(func.count()).select_from(SectionExperience)) == 1
    # Each resume still gets its own join rows.
    assert scalar(helpers, select(func.count()).select_from(ResumeExperience)) == 2
    assert scalar(helpers, select(func.count()).select_from(ResumeBulletPoint)) == 4


def test_a_job_version_shares_the_other_versions_bullets(helpers: Connection, account: int):
    new_doc(helpers, account, Resume, "Old")
    new_doc(helpers, account, Resume, "New")
    old = add_job(helpers, "resume", "Old", "2020 - 2023")
    new = add_job(helpers, "resume", "New", "2020 - present", bullets=["Shipped it."])
    helpers.execute(text("SELECT pg_temp.share_bullets(:old, :new)"), {"old": old, "new": new})

    assert old != new
    listed = helpers.execute(
        select(BulletPoint.content).join(ExperienceBulletPoint)
        .where(ExperienceBulletPoint.experience_id == new)
        .order_by(ExperienceBulletPoint.position)
    ).scalars().all()
    assert listed == ["Shipped it.", *BULLETS]
    assert scalar(helpers, select(func.count()).select_from(BulletPoint)) == 3


def test_cover_letter_bullets_stand_directly_in_their_section(helpers: Connection, account: int):
    new_doc(helpers, account, CoverLetter, "Letter")
    section = helpers.execute(
        Section.__table__.insert().values(account_id=account, title="key demands")
        .returning(Section.id)
    ).scalar()
    letter_section = call(helpers, "SELECT pg_temp.doc_section('cover_letter', 'Letter', :s, 1)",
                          s=section)
    helpers.execute(text("SELECT pg_temp.add_bullets('cover_letter', :ls, CAST(:b AS text[]))"),
                    {"ls": letter_section, "b": BULLETS})

    listed = select(func.count()).where(SectionBulletPoint.section_id == section)
    assert scalar(helpers, listed) == 2
    rows = helpers.execute(select(CoverLetterBulletPoint)).all()
    assert len(rows) == 2
    assert all(r.cover_letter_experience_id is None and r.cover_letter_project_id is None
               for r in rows)


def test_other_category_is_never_listed_under_a_section(helpers: Connection, account: int):
    new_doc(helpers, account, Resume, "Resume")
    section = call(helpers, "SELECT pg_temp.doc_section('resume', 'Resume', :s, 1)",
                   s=SKILLS_SECTION_ID)
    helpers.execute(text("SELECT pg_temp.add_skill_category('resume', :s, 1, 'Other',"
                         " ARRAY['Juggling'])"), {"s": section})
    listed = helpers.execute(select(SectionSkillCategory.category_id)).scalars().all()
    assert OTHER_CATEGORY_ID not in listed


def test_a_lookup_matching_two_rows_fails(helpers: Connection, account: int):
    for _ in range(2):
        helpers.execute(BulletPoint.__table__.insert().values(account_id=account, content="Twice."))
    with pytest.raises(DBAPIError, match="more than one row"), helpers.begin_nested():
        helpers.execute(text("SELECT pg_temp.item('bullet_point', 'bullet_id', 'content',"
                             " 'Twice.')"))


def test_a_project_done_for_someone_else_is_a_separate_version(helpers: Connection,
                                                                account: int):
    def project(done_for: str | None) -> int:
        return call(helpers, "SELECT pg_temp.project('Dashboard', NULL, '2024', :done_for)",
                    done_for=done_for)

    assert project("Acme") == project("Acme")
    assert len({project("Acme"), project("Freelance"), project(None)}) == 3


def test_set_resume_skills_replaces_the_list_in_order(helpers: Connection, account: int):
    new_doc(helpers, account, Resume, "Base")
    section = call(helpers, "SELECT pg_temp.doc_section('resume', 'Base', :sec, 1)",
                   sec=SKILLS_SECTION_ID)
    call(helpers, "SELECT pg_temp.add_skill_category('resume', :section, 1, 'Back End',"
                  " ARRAY['Go', 'Python', 'Rust'])", section=section)
    call(helpers, "SELECT pg_temp.set_resume_skills('Base', 'Back End',"
                  " ARRAY['Python', 'FastAPI', 'Go'])")
    shown = helpers.execute(text(
        "SELECT string_agg(k.skill_name, ', ' ORDER BY y.position) FROM resume_skill y"
        " JOIN skill k USING (skill_id)")).scalar()
    assert shown == "Python, FastAPI, Go"
    listed = helpers.execute(text(
        "SELECT string_agg(k.skill_name, ', ' ORDER BY x.position) FROM skill_category_skill x"
        " JOIN skill k USING (skill_id)")).scalar()
    assert listed == "Go, Python, Rust, FastAPI"  # Rust stays in the library list
