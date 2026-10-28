---
name: check
description: Run every automated check (backend lint, tests, and schema drift; front end types, lint, and tests), confirm no secrets or personal data would be committed, and sweep the docs for references left over from design changes. Use before the user commits, after a schema or design change, or when the user asks whether everything is consistent.
---

# Check the whole project

Report results in plain language. Don't commit or stage anything; the user handles git.

## 1. Automated checks

Run `scripts/check.sh` from the project root. It runs ruff, the backend tests, `alembic check`, TypeScript, oxlint, and the front end tests, and lists any that failed. It's the same script the git pre-commit hook runs.
- The front end tests include the accessibility checks: axe-core on every component state, and `src/test/a11yCoverage.test.ts` (every component has an axe test; CSS colors meet contrast). oxlint includes the jsx-a11y rules.
- The backend tests include `tests/test_docs.py`, which checks DATABASE.md against the models and API_ERRORS.md against the error codes, and `tests/test_seeds.py` for the committed seed SQL.
- If Postgres isn't running, the script says so. Ask the user to start it (`brew services start postgresql@18`) rather than skipping the database checks.
- For a failure, show the relevant output and fix it if the cause is clear. If a fix would change the design, ask first.

## 2. Secrets and personal data

- `git status --short` and `git ls-files --others --exclude-standard`: nothing under `db/seed_personal/`, no `.env` file other than `.env.example`, and no `*.dump` file may appear.
- `git check-ignore db/seed_personal/` should confirm the folder is ignored.
- Never print the contents of `.env` files or personal seed files.

## 3. Leftovers from design changes

The tests cover table definitions and error codes, but not prose. After a design change, old names linger in notes, flows, and instructions.
- See what changed: `git diff HEAD --stat`, then the diff of `docs/`, `backend/app/models.py`, and `backend/migrations/`.
- For every table, column, rule, or behavior that was removed or renamed, search `docs/`, `CLAUDE.md`, `README.md`, `.claude/skills/`, and `db/` for the old name or idea, and fix what's stale.
- Check that the status line in `CLAUDE.md` and the checkboxes in `docs/BUILD_PLAN.md` match where the build actually is.
- Read the user flow in `docs/APP_FLOW.md` against `docs/FRONTEND_CHECKS.md`: the same steps and rules should appear in both, without contradictions.

## 4. Report

- What passed (with test counts), what failed and why, and what you fixed.
- Anything that needs the user's decision.
- Workflow ideas, if a check keeps failing the same way (per CLAUDE.md, suggest; don't set up without approval).
