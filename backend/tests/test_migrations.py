"""The migrations build the schema in docs/DATABASE.md, including the built-in rows."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, inspect, text
from sqlalchemy.orm import Session

from app.models import (
    EDUCATION_SECTION_ID,
    EXPERIENCE_SECTION_ID,
    OTHER_CATEGORY_ID,
    PROJECTS_SECTION_ID,
    SKILLS_SECTION_ID,
    SUMMARY_SECTION_ID,
    Account,
    Base,
    Section,
    SkillCategory,
)
from tests.conftest import alembic_config


def test_migration_creates_every_model_table(engine: Engine):
    tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)


def test_migration_matches_models(engine: Engine):
    # Catches a model change that was never added to a migration (or the reverse).
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []


def test_built_in_sections(db: Session):
    rows = db.execute(text("SELECT id, account_id, title FROM section ORDER BY id")).all()
    assert rows == [
        (SUMMARY_SECTION_ID, None, "Summary"),
        (SKILLS_SECTION_ID, None, "Skills"),
        (EXPERIENCE_SECTION_ID, None, "Experience"),
        (PROJECTS_SECTION_ID, None, "Projects"),
        (EDUCATION_SECTION_ID, None, "Education"),
    ]


def test_built_in_other_category(db: Session):
    other = db.get(SkillCategory, OTHER_CATEGORY_ID)
    assert other is not None
    assert (other.account_id, other.category_name) == (None, "Other")


def test_new_rows_get_ids_after_the_built_ins(db: Session):
    account = Account()
    db.add(account)
    db.flush()
    section = Section(account_id=account.account_id, title="Volunteer Experience")
    category = SkillCategory(account_id=account.account_id, category_name="Languages")
    db.add_all([section, category])
    db.flush()
    assert section.id > EDUCATION_SECTION_ID
    assert category.category_id > OTHER_CATEGORY_ID


def test_downgrade_and_upgrade(engine: Engine, test_url: str):
    config = alembic_config(test_url)
    command.downgrade(config, "base")
    with engine.connect() as connection:
        assert inspect(connection).get_table_names() == ["alembic_version"]
        kinds = connection.execute(
            text("SELECT count(*) FROM pg_type WHERE typname = 'writing_rule_kind'")
        )
        assert kinds.scalar() == 0
    command.upgrade(config, "head")
    assert set(inspect(engine).get_table_names()) - {"alembic_version"} == set(
        Base.metadata.tables
    )


def test_constants_copied_into_migrations_match_the_app():
    # Migrations keep their own copies so they never change when app code does.
    import importlib.util

    from app import errors, models
    from app.config import BACKEND_DIR

    for path in (BACKEND_DIR / "migrations" / "versions").glob("*.py"):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        for name in ("BUILT_IN_SQLSTATE", "OTHER_CATEGORY_ID", "SUMMARY_SECTION_ID",
                     "SKILLS_SECTION_ID", "EXPERIENCE_SECTION_ID", "PROJECTS_SECTION_ID",
                     "EDUCATION_SECTION_ID"):
            if hasattr(migration, name):
                app_value = getattr(errors, name, None) or getattr(models, name)
                assert getattr(migration, name) == app_value, f"{path.name}: {name}"
