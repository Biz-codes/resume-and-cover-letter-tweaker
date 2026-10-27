"""The docs are the source of truth: check that the code still matches them.

- docs/DATABASE.md matches the SQLAlchemy models (tables, columns, types, NOT NULL, foreign
  keys and their ON DELETE rules, Unique and Primary key lines, defaults). test_migrations
  checks that the models match the migrations, so together the three can't drift apart.
- docs/API_ERRORS.md matches the backend's error codes and statuses, and the front end's
  ErrorCode type.
"""

import re

import pytest
from sqlalchemy import Boolean, Date, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql.sqltypes import TIMESTAMP

from app.config import BACKEND_DIR
from app.errors import STATUS, ErrorCode
from app.models import Base

ROOT = BACKEND_DIR.parent
DATABASE_MD = (ROOT / "docs" / "DATABASE.md").read_text()
API_ERRORS_MD = (ROOT / "docs" / "API_ERRORS.md").read_text()
CLIENT_TS = (ROOT / "frontend" / "src" / "api" / "client.ts").read_text()


def column_lists(body: str, label: str) -> list[tuple[str, ...]]:
    """The column lists on `Unique: (a, b)` or `Primary key: (a, b)` lines."""
    return [tuple(c.strip() for c in m.split(","))
            for m in re.findall(rf"^{label}: \(([^)]*)\)", body, flags=re.MULTILINE)]


def doc_tables() -> dict[str, dict]:
    """Every `### name` table in DATABASE.md: its rows and its Unique / Primary key lines."""
    tables = {}
    for block in re.split(r"^### ", DATABASE_MD, flags=re.MULTILINE)[1:]:
        name, _, body = block.partition("\n")
        rows = [
            [cell.strip() for cell in line.strip().strip("|").split("|")]
            for line in body.splitlines()
            if line.startswith("|") and not line.startswith("|--")
        ][1:]  # skip the header row
        if not rows:
            continue
        tables[name.strip()] = {
            "columns": {row[0]: (row[1], row[2]) for row in rows},
            "order": [row[0] for row in rows],
            "unique": column_lists(body, "Unique"),
            "primary_key": column_lists(body, "Primary key"),
        }
    return tables


DOC_TABLES = doc_tables()


def doc_type(column) -> str:
    """The type as DATABASE.md writes it."""
    kind = column.type
    if isinstance(kind, Enum):
        return kind.name
    if isinstance(kind, String) and not isinstance(kind, Text):
        return f"VARCHAR({kind.length})"
    if isinstance(kind, Integer):
        return "SERIAL" if column.primary_key and column.autoincrement is not False and len(
            column.table.primary_key.columns) == 1 else "INTEGER"
    for sql_type, name in [(Text, "TEXT"), (TIMESTAMP, "TIMESTAMP"), (Date, "DATE"),
                           (Boolean, "BOOLEAN")]:
        if isinstance(kind, sql_type):
            return name
    raise AssertionError(f"no doc name for {kind!r}")


def test_every_model_table_is_documented_and_every_documented_table_exists():
    assert set(DOC_TABLES) == set(Base.metadata.tables)


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_table_matches_the_doc(table_name: str):
    table = Base.metadata.tables[table_name]
    doc = DOC_TABLES[table_name]
    assert doc["order"] == [c.name for c in table.columns], "columns or their order differ"

    for column in table.columns:
        doc_type_name, constraints = doc["columns"][column.name]
        where = f"{table_name}.{column.name}"
        assert doc_type_name == doc_type(column), where

        single_pk = column.primary_key and len(table.primary_key.columns) == 1
        assert ("PRIMARY KEY" in constraints) == single_pk, where
        if not single_pk:
            assert ("NOT NULL" in constraints) == (not column.nullable), where
        assert ("DEFAULT" in constraints) == (column.server_default is not None), where

        foreign_keys: list[ForeignKey] = list(column.foreign_keys)
        match = re.search(r"REFERENCES (\w+)\((\w+)\) ON DELETE ([A-Z ]+?)\s*$", constraints)
        if not foreign_keys:
            assert match is None, f"{where}: doc has a foreign key the model doesn't"
            continue
        assert match, f"{where}: model has a foreign key the doc doesn't"
        fk = foreign_keys[0]
        assert (match[1], match[2]) == (fk.column.table.name, fk.column.name), where
        assert match[3] == fk.ondelete, where


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_unique_and_primary_key_lines_match(table_name: str):
    table = Base.metadata.tables[table_name]
    doc = DOC_TABLES[table_name]
    uniques = sorted(tuple(c.name for c in con.columns) for con in table.constraints
                     if isinstance(con, UniqueConstraint))
    assert sorted(doc["unique"]) == uniques
    key = tuple(c.name for c in table.primary_key.columns)
    assert doc["primary_key"] == ([key] if len(key) > 1 else [])


def documented_error_codes() -> dict[str, int]:
    rows = re.findall(r"^\| `(\w+)`\s*\| (\d{3})\s*\|", API_ERRORS_MD, flags=re.MULTILINE)
    return {code: int(status) for code, status in rows}


def test_error_codes_match_the_doc():
    assert documented_error_codes() == {code.value: status for code, status in STATUS.items()}
    assert set(STATUS) == set(ErrorCode)


def test_front_end_error_codes_match_the_doc():
    union = re.search(r"export type ErrorCode =([^\n]*\n(?:\s*\|[^\n]*\n)+)", CLIENT_TS)
    assert union, "ErrorCode type not found in frontend/src/api/client.ts"
    assert set(re.findall(r"'(\w+)'", union[1])) == set(documented_error_codes())


def test_api_errors_doc_names_the_trigger_sqlstate():
    from app.errors import BUILT_IN_SQLSTATE

    assert f"SQLSTATE `{BUILT_IN_SQLSTATE}`" in API_ERRORS_MD


def test_docs_folder_paths_exist():
    # Every repo path mentioned in backticks in the docs and CLAUDE.md should exist.
    docs = [*(ROOT / "docs").glob("*.md"), ROOT / "CLAUDE.md"]
    texts = [doc.read_text() for doc in docs]
    paths = {m for t in texts for m in re.findall(r"`((?:backend|frontend|db|docs)/[\w./-]+)`", t)}
    gitignored_or_user_made = {"backend/.env", "db/seed_personal/"}
    missing = [p for p in sorted(paths - gitignored_or_user_made)
               if not (ROOT / p.rstrip("/")).exists()]
    assert missing == []


def test_doc_links_resolve():
    for doc in [*(ROOT / "docs").glob("*.md"), ROOT / "CLAUDE.md", ROOT / "README.md"]:
        for target in re.findall(r"\]\(([^)#\s]+\.md)(?:#[^)]*)?\)", doc.read_text()):
            assert (doc.parent / target).exists(), f"{doc.name} links to missing {target}"
