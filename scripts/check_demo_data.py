"""Checks that the demo data (db/seed_demo.sql) holds nothing from the personal seed files.

Run by /check, from the project root: python3 scripts/check_demo_data.py
It looks for personal sentences (any quoted text of 20 characters or more), contact details
(emails, phone numbers, links), the names in each header, and organizations (roles, education,
projects' done_for, and postings, from the resumes named "[role] at [organization]"). A match
prints only the demo file's line number and the kind of match, never the personal text, and
exits with 1. With no personal seed files (on CI, or a fresh clone), there's nothing to check.
"""

import re
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent / "db"
DEMO = DB_DIR / "seed_demo.sql"

LITERAL = re.compile(r"'((?:[^']|'')*)'")
CONTACT = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|https?://[^\s'\"]+|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}")
# Helper calls in db/seed_helpers.sql, and which of their arguments is a name or organization.
NAME_ARGS = {"header": [0], "add_job": [4], "experience": [1], "find_experience": [1],
             "project": [3], "add_project": [9], "education": [1], "add_education": [4]}


def args(sql: str, start: int) -> list[str]:
    """The top-level arguments of the call whose opening parenthesis is at start."""
    parts, depth, quoted, current = [], 0, False, ""
    for char in sql[start + 1:]:
        if char == "'":
            quoted = not quoted
        elif not quoted and char == "(":
            depth += 1
        elif not quoted and char == ")":
            if depth == 0:
                break
            depth -= 1
        elif not quoted and depth == 0 and char == ",":
            parts.append(current.strip())
            current = ""
            continue
        current += char
    return [*parts, current.strip()]


def literal(arg: str) -> str | None:
    match = re.fullmatch(r"'((?:[^']|'')*)'", arg)
    return match.group(1).replace("''", "'") if match else None


def personal_strings(sql: str) -> list[tuple[str, str]]:
    """(kind, text) pairs to look for in the demo file."""
    found = [("contact detail", m) for m in CONTACT.findall(sql)]
    for text in (m.replace("''", "'") for m in LITERAL.findall(sql)):
        if len(text) >= 20:
            found.append(("sentence", text))
        org = re.fullmatch(r".+ at (.+)", text)
        if org:
            found.append(("organization", org.group(1)))
    for call in re.finditer(r"pg_temp\.(\w+)\(", sql):
        for index in NAME_ARGS.get(call.group(1), []):
            values = args(sql, call.end() - 1)
            value = literal(values[index]) if index < len(values) else None
            if not value:
                continue
            if call.group(1) == "header":
                found += [("name", word) for word in value.split() if len(word) >= 3]
            else:
                found.append(("organization", value))
    return found


def main() -> int:
    personal = sorted((DB_DIR / "seed_personal").glob("*.sql"))
    if not personal:
        print("No personal seed files, so there's nothing to compare the demo data against.")
        return 0
    lines = DEMO.read_text().lower().splitlines()
    hits = set()
    for kind, text in personal_strings("\n".join(p.read_text() for p in personal)):
        pattern = re.compile(rf"(?<!\w){re.escape(text.lower())}(?!\w)")
        hits.update((number, kind) for number, line in enumerate(lines, 1)
                    if pattern.search(line))
    for number, kind in sorted(hits):
        print(f"db/seed_demo.sql:{number}: matches a personal {kind}")
    if hits:
        return 1
    print(f"The demo data shares nothing with the {len(personal)} personal seed files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
