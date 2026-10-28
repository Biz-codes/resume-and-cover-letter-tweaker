"""Database triggers and delete rules: updated_at, built-in protection, ON DELETE behavior."""

from datetime import datetime

import pytest
from sqlalchemy import delete, inspect, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.errors import BUILT_IN_SQLSTATE
from app.models import (
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    SKILLS_SECTION_ID,
    Account,
    BulletPoint,
    CoverLetter,
    Experience,
    ExperienceBulletPoint,
    Header,
    Interview,
    JobPosting,
    JobPostingInterview,
    Resume,
    Section,
    SectionExperience,
    Skill,
    SkillCategory,
    SkillCategorySkill,
)

BUILT_IN_SECTION_IDS = [1, 2, 3, 4, 5]
LONG_AGO = datetime(2000, 1, 1)


def make_account(db: Session) -> Account:
    account = Account()
    db.add(account)
    db.flush()
    return account


def assert_blocked(db: Session, statement) -> None:
    """The statement fails with the built-in protection error, and nothing changes."""
    with pytest.raises(DBAPIError) as error, db.begin_nested():
        db.execute(statement)
    assert error.value.orig.sqlstate == BUILT_IN_SQLSTATE


# updated_at


def test_every_table_with_updated_at_has_a_trigger(db: Session):
    inspector = inspect(db.connection())
    tables = {
        name
        for name in inspector.get_table_names()
        if any(column["name"] == "updated_at" for column in inspector.get_columns(name))
    }
    triggers = set(
        db.scalars(
            text(
                "SELECT event_object_table FROM information_schema.triggers"
                " WHERE trigger_name LIKE '%\\_set\\_updated\\_at'"
            )
        )
    )
    assert tables
    assert triggers == tables


def test_updated_at_changes_on_update(db: Session):
    account = make_account(db)
    header = Header(
        account_id=account.account_id, full_name="Test User", created_at=LONG_AGO,
        updated_at=LONG_AGO,
    )
    db.add(header)
    db.flush()
    db.execute(update(Header).where(Header.header_id == header.header_id).values(full_name="New"))
    row = db.execute(
        select(Header.created_at, Header.updated_at, text("NOW()::timestamp")).where(
            Header.header_id == header.header_id
        )
    ).one()
    assert row.created_at == LONG_AGO
    assert row.updated_at == row[2]


# Built-in sections


@pytest.mark.parametrize("section_id", BUILT_IN_SECTION_IDS)
def test_built_in_section_cant_be_deleted(db: Session, section_id: int):
    assert_blocked(db, delete(Section).where(Section.id == section_id))
    assert db.get(Section, section_id) is not None


@pytest.mark.parametrize("section_id", BUILT_IN_SECTION_IDS)
def test_built_in_section_cant_be_renamed(db: Session, section_id: int):
    assert_blocked(db, update(Section).where(Section.id == section_id).values(title="Renamed"))


def test_built_in_section_cant_be_moved_to_an_account(db: Session):
    account = make_account(db)
    assert_blocked(
        db,
        update(Section)
        .where(Section.id == SKILLS_SECTION_ID)
        .values(account_id=account.account_id),
    )


def test_built_in_section_can_be_touched(db: Session):
    # Updates that don't rename it (e.g. updated_at) are fine.
    db.execute(update(Section).where(Section.id == SKILLS_SECTION_ID).values(updated_at=LONG_AGO))


def test_user_section_can_be_renamed_and_deleted(db: Session):
    account = make_account(db)
    section = Section(account_id=account.account_id, title="Volunteer")
    db.add(section)
    db.flush()
    db.execute(update(Section).where(Section.id == section.id).values(title="Volunteering"))
    db.execute(delete(Section).where(Section.id == section.id))
    assert db.scalar(select(Section.id).where(Section.id == section.id)) is None


# Built-in "Other" skill category


def test_other_category_cant_be_deleted(db: Session):
    assert_blocked(db, delete(SkillCategory).where(SkillCategory.category_id == OTHER_CATEGORY_ID))


@pytest.mark.parametrize("values", [{"category_name": "Misc"}, {"category_id": 999}])
def test_other_category_cant_be_changed(db: Session, values: dict):
    other = SkillCategory.category_id == OTHER_CATEGORY_ID
    assert_blocked(db, update(SkillCategory).where(other).values(**values))


# Library join tables: deleting a parent removes its list, never its children


def test_deleting_a_category_keeps_its_skills(db: Session):
    account = make_account(db)
    category = SkillCategory(account_id=account.account_id, category_name="Languages")
    skill = Skill(account_id=account.account_id, skill_name="Go")
    db.add_all([category, skill])
    db.flush()
    db.add(
        SkillCategorySkill(category_id=category.category_id, skill_id=skill.skill_id, position=1)
    )
    db.flush()
    db.execute(delete(SkillCategory).where(SkillCategory.category_id == category.category_id))
    assert db.get(Skill, skill.skill_id) is not None
    assert db.scalar(select(SkillCategorySkill.skill_id)) is None


def test_two_jobs_share_bullets_and_deleting_one_keeps_them(db: Session):
    account = make_account(db)
    senior = Experience(account_id=account.account_id, role_title="Senior Engineer",
                        organization="Acme")
    plain = Experience(account_id=account.account_id, role_title="Engineer", organization="Acme")
    bullet = BulletPoint(account_id=account.account_id, content="Built things.")
    db.add_all([senior, plain, bullet])
    db.flush()
    for role in (senior, plain):
        db.add(ExperienceBulletPoint(experience_id=role.experience_id, bullet_id=bullet.bullet_id,
                                     position=1))
        db.add(SectionExperience(section_id=EXPERIENCE_SECTION_ID,
                                 experience_id=role.experience_id, position=1))
    db.flush()
    db.execute(delete(Experience).where(Experience.experience_id == senior.experience_id))
    assert db.get(BulletPoint, bullet.bullet_id) is not None
    assert list(db.scalars(select(ExperienceBulletPoint.experience_id))) == [plain.experience_id]


def test_a_child_is_listed_under_a_parent_only_once(db: Session):
    account = make_account(db)
    role = Experience(account_id=account.account_id, role_title="Engineer", organization="Acme")
    bullet = BulletPoint(account_id=account.account_id, content="Built things.")
    db.add_all([role, bullet])
    db.flush()
    db.add(ExperienceBulletPoint(experience_id=role.experience_id, bullet_id=bullet.bullet_id,
                                 position=1))
    db.flush()
    with pytest.raises(DBAPIError) as error, db.begin_nested():
        db.execute(text("INSERT INTO experience_bullet_point VALUES (:e, :b, 2)"),
                   {"e": role.experience_id, "b": bullet.bullet_id})
    assert error.value.orig.sqlstate == "23505"


def test_deleting_a_section_keeps_the_items_it_listed(db: Session):
    account = make_account(db)
    section = Section(account_id=account.account_id, title="Freelance")
    role = Experience(account_id=account.account_id, role_title="Consultant", organization="Self")
    db.add_all([section, role])
    db.flush()
    db.add(SectionExperience(section_id=section.id, experience_id=role.experience_id, position=1))
    db.flush()
    db.execute(delete(Section).where(Section.id == section.id))
    assert db.get(Experience, role.experience_id) is not None


# Other delete rules


def test_deleting_a_header_keeps_its_postings_resumes_and_letters(db: Session):
    account = make_account(db)
    header = Header(account_id=account.account_id, full_name="Test User", headline="Engineer")
    db.add(header)
    db.flush()
    posting = JobPosting(account_id=account.account_id, url="https://example.com/job",
                         organization="Acme", role_title="Engineer", description="Build things.",
                         header_id=header.header_id)
    resume = Resume(account_id=account.account_id, name="Base", header_id=header.header_id)
    letter = CoverLetter(account_id=account.account_id, name="Base", header_id=header.header_id)
    db.add_all([posting, resume, letter])
    db.flush()
    db.execute(delete(Header).where(Header.header_id == header.header_id))
    db.expire_all()
    assert db.get(Resume, resume.resume_id).header_id is None
    assert db.get(CoverLetter, letter.letter_id).header_id is None
    assert db.get(JobPosting, posting.job_posting_id).header_id is None


def test_deleting_a_resume_keeps_its_copies(db: Session):
    account = make_account(db)
    original = Resume(account_id=account.account_id, name="Tech base")
    db.add(original)
    db.flush()
    copy = Resume(
        account_id=account.account_id, name="Copy", based_on_resume_id=original.resume_id
    )
    db.add(copy)
    db.flush()
    db.execute(delete(Resume).where(Resume.resume_id == original.resume_id))
    assert db.scalar(
        select(Resume.based_on_resume_id).where(Resume.resume_id == copy.resume_id)
    ) is None


def test_deleting_an_account_deletes_its_content_but_not_built_ins(db: Session):
    account = make_account(db)
    db.add(Section(account_id=account.account_id, title="Volunteer"))
    db.flush()
    db.execute(delete(Account).where(Account.account_id == account.account_id))
    assert db.scalar(text("SELECT count(*) FROM section")) == len(BUILT_IN_SECTION_IDS)
    assert db.get(SkillCategory, OTHER_CATEGORY_ID) is not None


# Interviews


def make_posting(db: Session, account: Account, title: str) -> JobPosting:
    posting = JobPosting(account_id=account.account_id, url=f"https://example.com/{title}",
                         organization="Acme", role_title=title, description="Build things.")
    db.add(posting)
    db.flush()
    return posting


def test_one_interview_can_cover_several_postings(db: Session):
    account = make_account(db)
    frontend, backend = make_posting(db, account, "Frontend"), make_posting(db, account, "Backend")
    interview = Interview(account_id=account.account_id, interview_on=LONG_AGO.date())
    db.add(interview)
    db.flush()
    db.add_all([JobPostingInterview(job_posting_id=p.job_posting_id,
                                    interview_id=interview.interview_id)
                for p in (frontend, backend)])
    db.flush()

    # Deleting one posting removes only its link; the shared interview stays.
    db.execute(delete(JobPosting).where(JobPosting.job_posting_id == frontend.job_posting_id))
    assert db.get(Interview, interview.interview_id) is not None
    assert list(db.scalars(select(JobPostingInterview.job_posting_id))) == [backend.job_posting_id]
