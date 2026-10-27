"""SQLAlchemy models for every table in docs/DATABASE.md.

The tables match DATABASE.md column for column; change both together. Library items
store no parent ids; parents list their children in the library join tables. Triggers (updated_at,
built-in protection) and the built-in rows live in the migrations, not here.
"""

import enum
from datetime import date, datetime

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Date,
    Enum,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Built-in rows created by the first migration. Never look these up by title.
SUMMARY_SECTION_ID = 1
SKILLS_SECTION_ID = 2
EXPERIENCE_SECTION_ID = 3
PROJECTS_SECTION_ID = 4
EDUCATION_SECTION_ID = 5
OTHER_CATEGORY_ID = 1


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_N_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


def fk(target: str, ondelete: str = "CASCADE") -> ForeignKey:
    return ForeignKey(target, ondelete=ondelete)


def created_at() -> Mapped[datetime | None]:
    return mapped_column(TIMESTAMP, server_default=func.now())


def updated_at() -> Mapped[datetime | None]:
    # Kept current by a database trigger on every update.
    return mapped_column(TIMESTAMP, server_default=func.now())


class WritingRuleKind(enum.StrEnum):
    term = "term"
    pattern = "pattern"


# Library tables


class Account(Base):
    __tablename__ = "account"

    account_id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Header(Base):
    __tablename__ = "header"

    header_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    full_name: Mapped[str] = mapped_column(String(100))
    headline: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50))
    location: Mapped[str | None] = mapped_column(String(100))
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    github_url: Mapped[str | None] = mapped_column(Text)
    portfolio_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class JobPosting(Base):
    __tablename__ = "job_posting"

    job_posting_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    url: Mapped[str] = mapped_column(Text)
    company: Mapped[str] = mapped_column(String(100))
    job_title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    # Header chosen for the posting; its new resumes and cover letters start with it.
    header_id: Mapped[int | None] = mapped_column(fk("header.header_id", "SET NULL"))
    applied_on: Mapped[date | None] = mapped_column(Date)
    rejected_on: Mapped[date | None] = mapped_column(Date)
    hired_on: Mapped[date | None] = mapped_column(Date)
    contacts: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()



class Interview(Base):
    __tablename__ = "interview"

    interview_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    interview_on: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class JobPostingInterview(Base):
    """Links an interview to every posting it covered (one interview can cover several)."""

    __tablename__ = "job_posting_interview"

    job_posting_id: Mapped[int] = mapped_column(fk("job_posting.job_posting_id"), primary_key=True)
    interview_id: Mapped[int] = mapped_column(fk("interview.interview_id"), primary_key=True)


class Resume(Base):
    __tablename__ = "resume"

    resume_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    job_posting_id: Mapped[int | None] = mapped_column(fk("job_posting.job_posting_id"))
    name: Mapped[str] = mapped_column(String(100))
    tone_set_id: Mapped[int | None] = mapped_column(fk("tone_set.tone_set_id", "SET NULL"))
    header_id: Mapped[int | None] = mapped_column(fk("header.header_id", "SET NULL"))
    based_on_resume_id: Mapped[int | None] = mapped_column(fk("resume.resume_id", "SET NULL"))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class CoverLetter(Base):
    __tablename__ = "cover_letter"

    letter_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    job_posting_id: Mapped[int | None] = mapped_column(fk("job_posting.job_posting_id"))
    name: Mapped[str] = mapped_column(String(100))
    header_id: Mapped[int | None] = mapped_column(fk("header.header_id", "SET NULL"))
    tone_set_id: Mapped[int | None] = mapped_column(fk("tone_set.tone_set_id", "SET NULL"))
    based_on_letter_id: Mapped[int | None] = mapped_column(
        fk("cover_letter.letter_id", "SET NULL")
    )
    addressee: Mapped[str | None] = mapped_column(String(100))
    sign_off_id: Mapped[int | None] = mapped_column(fk("sign_off.sign_off_id", "SET NULL"))
    # Empty means the header's full_name.
    signature_name: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Section(Base):
    __tablename__ = "section"
    __table_args__ = (UniqueConstraint("account_id", "title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Empty for the built-in sections.
    account_id: Mapped[int | None] = mapped_column(fk("account.account_id"))
    title: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class NarrativeContent(Base):
    __tablename__ = "narrative_content"

    content_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class SkillCategory(Base):
    __tablename__ = "skill_category"

    category_id: Mapped[int] = mapped_column(primary_key=True)
    # Empty for the built-in "Other" category.
    account_id: Mapped[int | None] = mapped_column(fk("account.account_id"))
    category_name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Skill(Base):
    __tablename__ = "skill"

    skill_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    skill_name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Experience(Base):
    __tablename__ = "experience"

    experience_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    job_title: Mapped[str] = mapped_column(String(100))
    company: Mapped[str] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(100))
    dates: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Project(Base):
    __tablename__ = "project"

    project_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    project_title: Mapped[str] = mapped_column(String(100))
    done_for: Mapped[str | None] = mapped_column(String(100))
    url: Mapped[str | None] = mapped_column(Text)
    dates: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class BulletPoint(Base):
    __tablename__ = "bullet_point"

    bullet_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class Education(Base):
    __tablename__ = "education"

    education_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    degree: Mapped[str] = mapped_column(String(100))
    institution: Mapped[str] = mapped_column(String(100))
    details: Mapped[str | None] = mapped_column(Text)
    graduation: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class WritingRule(Base):
    __tablename__ = "writing_rule"

    writing_rule_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    kind: Mapped[WritingRuleKind] = mapped_column(Enum(WritingRuleKind, name="writing_rule_kind"))
    rule_text: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("TRUE"))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class ToneSet(Base):
    __tablename__ = "tone_set"

    tone_set_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class ToneRule(Base):
    __tablename__ = "tone_rule"

    tone_rule_id: Mapped[int] = mapped_column(primary_key=True)
    tone_set_id: Mapped[int] = mapped_column(fk("tone_set.tone_set_id"))
    rule_text: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


class SignOff(Base):
    __tablename__ = "sign_off"

    sign_off_id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(fk("account.account_id"))
    text: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = created_at()
    updated_at: Mapped[datetime | None] = updated_at()


# Library join tables: each parent lists the children that can go under it, with a
# default order. Nothing references these rows, so the (parent, child) pair is the key.


class SectionNarrativeContent(Base):
    __tablename__ = "section_narrative_content"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    content_id: Mapped[int] = mapped_column(fk("narrative_content.content_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SectionSkillCategory(Base):
    __tablename__ = "section_skill_category"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    category_id: Mapped[int] = mapped_column(fk("skill_category.category_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SectionExperience(Base):
    __tablename__ = "section_experience"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    experience_id: Mapped[int] = mapped_column(fk("experience.experience_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SectionProject(Base):
    __tablename__ = "section_project"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    project_id: Mapped[int] = mapped_column(fk("project.project_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SectionBulletPoint(Base):
    __tablename__ = "section_bullet_point"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    bullet_id: Mapped[int] = mapped_column(fk("bullet_point.bullet_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SectionEducation(Base):
    __tablename__ = "section_education"

    section_id: Mapped[int] = mapped_column(fk("section.id"), primary_key=True)
    education_id: Mapped[int] = mapped_column(fk("education.education_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class SkillCategorySkill(Base):
    __tablename__ = "skill_category_skill"

    category_id: Mapped[int] = mapped_column(fk("skill_category.category_id"), primary_key=True)
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class ProjectSkill(Base):
    __tablename__ = "project_skill"

    project_id: Mapped[int] = mapped_column(fk("project.project_id"), primary_key=True)
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class ExperienceBulletPoint(Base):
    __tablename__ = "experience_bullet_point"

    experience_id: Mapped[int] = mapped_column(fk("experience.experience_id"), primary_key=True)
    bullet_id: Mapped[int] = mapped_column(fk("bullet_point.bullet_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class ProjectBulletPoint(Base):
    __tablename__ = "project_bullet_point"

    project_id: Mapped[int] = mapped_column(fk("project.project_id"), primary_key=True)
    bullet_id: Mapped[int] = mapped_column(fk("bullet_point.bullet_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


# Resume join tables


class ResumeSection(Base):
    __tablename__ = "resume_section"
    __table_args__ = (UniqueConstraint("resume_id", "section_id"),)

    resume_section_id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(fk("resume.resume_id"))
    section_id: Mapped[int] = mapped_column(fk("section.id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeNarrativeContent(Base):
    __tablename__ = "resume_narrative_content"
    __table_args__ = (UniqueConstraint("resume_section_id", "content_id"),)

    resume_narrative_content_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    content_id: Mapped[int] = mapped_column(fk("narrative_content.content_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeSkillCategory(Base):
    __tablename__ = "resume_skill_category"
    __table_args__ = (UniqueConstraint("resume_section_id", "category_id"),)

    resume_skill_category_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    category_id: Mapped[int] = mapped_column(fk("skill_category.category_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeSkill(Base):
    __tablename__ = "resume_skill"
    __table_args__ = (UniqueConstraint("resume_skill_category_id", "skill_id"),)

    resume_skill_id: Mapped[int] = mapped_column(primary_key=True)
    resume_skill_category_id: Mapped[int] = mapped_column(
        fk("resume_skill_category.resume_skill_category_id")
    )
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeExperience(Base):
    __tablename__ = "resume_experience"
    __table_args__ = (UniqueConstraint("resume_section_id", "experience_id"),)

    resume_experience_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    experience_id: Mapped[int] = mapped_column(fk("experience.experience_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeProject(Base):
    __tablename__ = "resume_project"
    __table_args__ = (UniqueConstraint("resume_section_id", "project_id"),)

    resume_project_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    project_id: Mapped[int] = mapped_column(fk("project.project_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeProjectSkill(Base):
    __tablename__ = "resume_project_skill"
    __table_args__ = (UniqueConstraint("resume_project_id", "skill_id"),)

    resume_project_skill_id: Mapped[int] = mapped_column(primary_key=True)
    resume_project_id: Mapped[int] = mapped_column(fk("resume_project.resume_project_id"))
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeBulletPoint(Base):
    __tablename__ = "resume_bullet_point"
    __table_args__ = (UniqueConstraint("resume_section_id", "bullet_id"),)

    resume_bullet_point_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    resume_experience_id: Mapped[int | None] = mapped_column(
        fk("resume_experience.resume_experience_id")
    )
    resume_project_id: Mapped[int | None] = mapped_column(fk("resume_project.resume_project_id"))
    bullet_id: Mapped[int] = mapped_column(fk("bullet_point.bullet_id"))
    position: Mapped[int] = mapped_column(Integer)


class ResumeEducation(Base):
    __tablename__ = "resume_education"
    __table_args__ = (UniqueConstraint("resume_section_id", "education_id"),)

    resume_education_id: Mapped[int] = mapped_column(primary_key=True)
    resume_section_id: Mapped[int] = mapped_column(fk("resume_section.resume_section_id"))
    education_id: Mapped[int] = mapped_column(fk("education.education_id"))
    position: Mapped[int] = mapped_column(Integer)


# Cover letter join tables


class CoverLetterSection(Base):
    __tablename__ = "cover_letter_section"
    __table_args__ = (UniqueConstraint("letter_id", "section_id"),)

    cover_letter_section_id: Mapped[int] = mapped_column(primary_key=True)
    letter_id: Mapped[int] = mapped_column(fk("cover_letter.letter_id"))
    section_id: Mapped[int] = mapped_column(fk("section.id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterNarrativeContent(Base):
    __tablename__ = "cover_letter_narrative_content"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "content_id"),)

    cover_letter_narrative_content_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    content_id: Mapped[int] = mapped_column(fk("narrative_content.content_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterSkillCategory(Base):
    __tablename__ = "cover_letter_skill_category"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "category_id"),)

    cover_letter_skill_category_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    category_id: Mapped[int] = mapped_column(fk("skill_category.category_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterSkill(Base):
    __tablename__ = "cover_letter_skill"
    __table_args__ = (UniqueConstraint("cover_letter_skill_category_id", "skill_id"),)

    cover_letter_skill_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_skill_category_id: Mapped[int] = mapped_column(
        fk("cover_letter_skill_category.cover_letter_skill_category_id")
    )
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterExperience(Base):
    __tablename__ = "cover_letter_experience"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "experience_id"),)

    cover_letter_experience_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    experience_id: Mapped[int] = mapped_column(fk("experience.experience_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterProject(Base):
    __tablename__ = "cover_letter_project"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "project_id"),)

    cover_letter_project_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    project_id: Mapped[int] = mapped_column(fk("project.project_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterProjectSkill(Base):
    __tablename__ = "cover_letter_project_skill"
    __table_args__ = (UniqueConstraint("cover_letter_project_id", "skill_id"),)

    cover_letter_project_skill_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_project_id: Mapped[int] = mapped_column(
        fk("cover_letter_project.cover_letter_project_id")
    )
    skill_id: Mapped[int] = mapped_column(fk("skill.skill_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterBulletPoint(Base):
    __tablename__ = "cover_letter_bullet_point"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "bullet_id"),)

    cover_letter_bullet_point_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    cover_letter_experience_id: Mapped[int | None] = mapped_column(
        fk("cover_letter_experience.cover_letter_experience_id")
    )
    cover_letter_project_id: Mapped[int | None] = mapped_column(
        fk("cover_letter_project.cover_letter_project_id")
    )
    bullet_id: Mapped[int] = mapped_column(fk("bullet_point.bullet_id"))
    position: Mapped[int] = mapped_column(Integer)


class CoverLetterEducation(Base):
    __tablename__ = "cover_letter_education"
    __table_args__ = (UniqueConstraint("cover_letter_section_id", "education_id"),)

    cover_letter_education_id: Mapped[int] = mapped_column(primary_key=True)
    cover_letter_section_id: Mapped[int] = mapped_column(
        fk("cover_letter_section.cover_letter_section_id")
    )
    education_id: Mapped[int] = mapped_column(fk("education.education_id"))
    position: Mapped[int] = mapped_column(Integer)
