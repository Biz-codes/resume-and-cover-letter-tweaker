# Build Plan

The order for building the app, starting from the finished design docs. Each phase ends with something that works and can be tried. Check items off as they're done, and adjust the plan here if it changes.

## Before starting (user)
- [ ] **Anthropic API key** (needed by phase 5, not before): create an Anthropic Console account, add billing (separate from a Claude.ai subscription), and create a key. It goes in `backend/.env` as `ANTHROPIC_API_KEY=...`.
- [ ] **Existing resumes** (needed by phase 2): have them ready as PDFs or text to paste.

Claude can't read or write `.env` files (a hook blocks it), so the user creates `backend/.env` by copying `backend/.env.example` and filling in the values.

## Environment notes
- **Installed:** Python 3.14, Node 24, npm, git, and PostgreSQL 18 from Homebrew, accepting connections on port 5432.
- **Not installed and not needed:** Docker, uv, gh.
- **Lint hook:** runs `ruff` from `backend/.venv` and `tsc -b` in `frontend/` after each edit, once those are installed.

## Phase 1: Project setup
Goal: an empty app that runs, with the full schema in a real database.

1. **Backend skeleton** in `backend/`:
   - Create a virtual environment at `backend/.venv` and install `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `psycopg`, `pydantic-settings`, `anthropic`, `httpx`, `beautifulsoup4`, `pytest`, and `ruff`. Record them in a requirements file.
   - Add a FastAPI app with a health-check endpoint, and settings that read `backend/.env`.
   - Add a committed `backend/.env.example` listing `DATABASE_URL` and `ANTHROPIC_API_KEY` with placeholder values.
2. **Error handling foundation:** the error response shape, error codes, and exception handlers from [API_ERRORS.md](API_ERRORS.md), including mapping database errors to codes. Every write runs in one transaction.
3. **Database:** create the app database and a separate test database in the local Postgres. The user adds the connection string to `backend/.env`.
4. **Models and first migration** from [DATABASE.md](DATABASE.md):
   - SQLAlchemy models for every table.
   - The Postgres enum `writing_rule_kind`.
   - Every constraint, `Unique:` line, and `ON DELETE` rule (including the `SET NULL` and `SET DEFAULT` exceptions).
   - Triggers that keep `updated_at` current, and triggers that block deleting or renaming the built-in rows.
   - The built-in rows: the five sections ("Summary", "Skills", "Experience", "Projects", "Education") with fixed ids, and the "Other" skill category with id 1. Move the id sequences past the fixed ids.
5. **`db/seed_defaults.sql`:** the starting writing rules from [WRITING_RULES.md](WRITING_RULES.md) and the "Sincerely" sign-off, added for every account that doesn't have them yet.
6. **Front end skeleton** in `frontend/`: a Vite + React + TypeScript app with Vitest, and an API client that reads the error shape from API_ERRORS.md.
7. **Tests:** pytest setup against the test database. Check that the migration runs, the triggers work, and built-in rows can't be deleted or renamed.

## Phase 2: Seed personal data
Goal: the user's real resume content in the database.

1. The user provides each existing resume. Use `/seed-resume` to translate it into `db/seed_personal.sql` (gitignored).
2. Run the seeds in order: `db/seed_personal.sql`, then `db/seed_defaults.sql`.
3. Check the result with the user: the base resumes should reproduce the original resumes.

## Phase 3: Library management
Goal: the user can view and edit all their content in the app.

- Pages to create, edit, and delete: account header details, sections, skill categories and skills, experiences, projects (with their skills), bullet points, education, narrative content, writing rules, tone sets and rules, and sign-offs.
- Delete warnings, built-in protections, and the skill category move to "Other", per [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

## Phase 4: Building resumes and cover letters by hand
Goal: the full resume and cover letter tree works without AI.

- Create base resumes and cover letters, add sections, and add any library items in any order, including mixed sections and the nested skills and bullets.
- Copy a version, warn before editing a base version, and keep the cover letter linked to its resume.
- Plain-text output with copy buttons, using the layout in [APP_FLOW.md](APP_FLOW.md).

## Phase 5: Job postings and AI
Goal: the full flow in APP_FLOW.md. Needs the Anthropic API key.

1. **Job posting:** fetch and extract a posting from a url, with the paste-in fallback, and let the user correct the result.
2. **Suggestions**, one step at a time, per the AI integration notes in [TECH_STACK.md](TECH_STACK.md): starting point and headline, sections, each section's content, rewordings (saved as new rows), and the cover letter's greeting.
3. **Writing rules:** code check for banned terms, Claude for judgment calls and patterns, and the tone set.
4. **Final review** of the resume and cover letter together.
5. **Cost check:** measure real API usage against the estimate in TECH_STACK.md.

## Phase 6: Polish
- Fix rough edges found while using the app for real applications.
- Record the date applied on job postings, and make past versions easy to browse and reuse.
