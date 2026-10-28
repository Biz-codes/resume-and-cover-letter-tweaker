---
name: docs-audit
description: Audit every doc (.md files) and code comment against the actual code, fix what's stale, wrong, or missing, and report the decisions the user needs to make. A full sweep, not just recent changes. Run only when the user asks for it.
disable-model-invocation: true
---

# Audit the docs against the code

The docs are the source of truth for the design (CLAUDE.md), so they have to describe what the code actually does. This audit reads all of them and checks each claim against the code. `/check` only looks for leftovers from recent changes and runs the tests; this covers everything, whether or not it changed recently.

Don't commit or stage anything; the user handles git. The user edits the docs by hand, so build on their wording and never revert a name or phrase they changed. Don't read `.env` files or anything in `db/seed_personal/` (personal data); `.env.example` and `db/seed_helpers.sql` are fine.

## 1. Gather

- Every doc: `find . -name '*.md' -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/.pytest_cache/*' -not -path './db/seed_personal/*'`. That includes `README.md`, `CLAUDE.md`, `docs/`, and every `.claude/skills/*/SKILL.md`.
- The code they describe: `backend/app/` (models, routers, shared modules), `backend/tests/`, `backend/migrations/`, `frontend/src/`, `frontend/a11yChecks.ts`, `frontend/vite.config.ts`, the config files, `db/*.sql`, `scripts/`, `.githooks/`, `.claude/hooks/`, and `.claude/settings.json`.
- Read the docs in full. Read DATABASE.md's prose and notes closely; `backend/tests/test_docs.py` already checks its table columns, `Unique:` lines, links, and error codes, but not its descriptions or notes.

## 2. Check each claim

For each doc, list the concrete claims it makes and confirm each one in the code. Where there's no code yet (later phases in BUILD_PLAN.md), check only that the doc is consistent with the other docs and with the schema.

- **Names and paths:** every file, folder, function, constant, command, route, table, column, and error code a doc mentions exists and is spelled the same.
- **Behavior:** rules in FRONTEND_CHECKS.md, API_ERRORS.md, DATABASE.md notes, and APP_FLOW.md match what the routers and pages do: defaults, what a delete affects, version and lock rules, duplicate checks, error codes, and the exact messages quoted.
- **Conventions:** the patterns in TECH_STACK.md ("API conventions", "Accessibility") and CLAUDE.md ("Conventions") are what the code follows. If several files break a convention the same way, the convention may be what's out of date; ask.
- **Tooling:** the hooks, skills, scripts, and test setup described in CLAUDE.md, TECH_STACK.md, BUILD_PLAN.md, and each SKILL.md match the files: what runs, when, and what it checks. Skills tell Claude what to do, so a stale step there causes wrong work later.
- **Status:** CLAUDE.md's status line and BUILD_PLAN.md's checkboxes match what's built.
- **Contradictions between docs:** the same rule written two ways (e.g. APP_FLOW.md vs FRONTEND_CHECKS.md, CLAUDE.md vs DATABASE.md). App-side rules are meant to appear in both DATABASE.md and FRONTEND_CHECKS.md; check both copies agree.
- **Gaps:** behavior or conventions in the code that nothing documents but that the next build step depends on (a default, a shared helper, a pattern every page follows). Add them where a reader would look.
- **Code comments and docstrings:** module headers, function docstrings, and inline comments in the files above say what the code does now, and any doc section they point to still exists under that name. Match the surrounding comment density; don't add comments to explain code that's already clear.

Then search for leftovers: the old names of anything renamed or removed (check `git log` for recent commits that describe renames), across docs, skills, comments, and `db/`.

## 3. Fix

- **Fix it** when the doc is wrong about what the code does, a path or name is stale, a comment is out of date, or something the next step depends on is undocumented. Keep each fix as small as the problem, in the doc's existing voice and format.
- **Ask first** when the code and the doc disagree and either could be the intended design. Don't change code behavior to match a doc, or a doc to match code that looks like a bug, without the user's answer.
- A code change is fine only when it's small and only makes the code match a documented convention (e.g. moving a constant to where the docs say it lives). Mention each one in the report.
- Run `scripts/check.sh` afterward. It needs Postgres running; if it isn't, ask the user to start it (`brew services start postgresql@18`).

## 4. Report

- What was wrong and what you fixed, grouped by doc, one line each, saying what the doc claimed and what's true.
- Any code changed, and why.
- Questions for the user: each disagreement where the intended design is unclear, with what the code does and what the doc says.
- Check results (test counts).
