# Build Plan

The order for building the app, starting from the finished design docs. Each phase ends with something that works and can be tried. Check items off as they're done, and adjust the plan here if it changes.

## Before starting (user)
- [ ] **Anthropic API key** (needed by phase 5, not before): create an Anthropic Console account, add billing (separate from a Claude.ai subscription), and create a key. It goes in `backend/.env` as `ANTHROPIC_API_KEY=...`.
- [ ] **Existing resumes** (needed by phase 2): have them ready as PDFs or text to paste.

Claude can't read or write `.env` files (a hook blocks it), so the user creates `backend/.env` by copying `backend/.env.example` and filling in the values.

## Environment notes
- **Installed:** Python 3.14, Node 24, npm, git, and PostgreSQL 18 from Homebrew (`brew services`), on port **5433** with no password for the Mac user. Use its tools by full path, e.g. `$(brew --prefix postgresql@18)/bin/psql -p 5433`.
- **Old Postgres 14** (EnterpriseDB installer, `/Library/PostgreSQL/14`) still runs on port 5432 and starts with the Mac. The app doesn't use it.
- **Not installed and not needed:** Docker, uv, gh.
- **Lint hook:** runs `ruff` from `backend/.venv` and `tsc -b` in `frontend/` after each edit, once those are installed.

## Phase 1: Project setup (done)
Goal: an empty app that runs, with the full schema in a real database.

1. [x] **Backend skeleton** in `backend/`:
   - Create a virtual environment at `backend/.venv` and install `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `psycopg`, `pydantic-settings`, `anthropic`, `httpx`, `beautifulsoup4`, `pytest`, and `ruff`. Record them in a requirements file.
   - Add a FastAPI app with a health-check endpoint, and settings that read `backend/.env`.
   - Add a committed `backend/.env.example` listing `DATABASE_URL` and `ANTHROPIC_API_KEY` with placeholder values.
2. [x] **Error handling foundation:** the error response shape, error codes, and exception handlers from [API_ERRORS.md](API_ERRORS.md), including mapping database errors to codes. Every write runs in one transaction.
3. [x] **Database:** create the app database (`resume_tweaker`) and a separate test database (`resume_tweaker_test`) in the local Postgres 18. The user copies `backend/.env.example` to `backend/.env`; the database URLs in it work as is.
4. [x] **Models and first migration** from [DATABASE.md](DATABASE.md):
   - SQLAlchemy models for every table.
   - The Postgres enum `writing_rule_kind`.
   - Every constraint, `Unique:` line, and `ON DELETE` rule (including the `SET NULL` exceptions). The design changes made while seeding (library join tables, headers, interviews) were folded into this one migration before the first commit.
   - Triggers that keep `updated_at` current, and triggers that block deleting or renaming the built-in rows.
   - The built-in rows: the five sections ("Summary", "Skills", "Experience", "Projects", "Education") with fixed ids, and the "Other" skill category with id 1. Move the id sequences past the fixed ids.
5. [x] **`db/seed_defaults.sql`:** the starting writing rules from [WRITING_RULES.md](WRITING_RULES.md) and the "Sincerely" sign-off, added for every account that doesn't have them yet.
6. [x] **Front end skeleton** in `frontend/`: a Vite + React + TypeScript app with Vitest, and an API client that reads the error shape from API_ERRORS.md.
7. [x] **Tests:** pytest setup against the test database. Check that the migration runs, the triggers work, and built-in rows can't be deleted or renamed.

## Phase 2: Seed personal data
Goal: the user's real resume and cover letter content in the database.

1. The user provides each existing resume or cover letter, one at a time. Use `/seed-resume` to translate it into its own file in `db/seed_personal/` (gitignored), reusing anything already in the library.
2. Run each file once, before translating the next one, so the next one can match against it. After the first, run `db/seed_defaults.sql`.
3. Check the result with the user: each seeded resume and cover letter should reproduce the original.

## Phase 3: Library management
Goal: the user can view and edit all their content in the app.

- Pages to create, edit, and delete: headers (name, headline, contact details), sections, skill categories and skills, experiences, projects (with their skills), bullet points, education, narrative content, writing rules, tone sets and rules, and sign-offs.
- Edit each parent's list of children (a section's items, a category's skills, a job's or project's bullets), show items no parent lists, and handle header and job versions, per [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).
- Delete warnings, built-in protections, and the skill category move to "Other", per [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

## Phase 4: Building resumes and cover letters by hand
Goal: the full resume and cover letter tree works without AI.

- Create base resumes and cover letters, add sections, and add any library items in any order, including mixed sections and the nested skills and bullets.
- Create a job posting by hand (pasted description) and pick its header. Create resumes and cover letters under it, each starting from the posting's header with the use / edit / pick another choice. Resumes and cover letters aren't linked to each other directly.
- Copy a version and warn before editing a base version.
- Record the applied date on a posting (plus rejection and hire dates, contacts, and interviews, which can be shared across postings), which locks its resumes and cover letters; editing a library item a locked version uses saves a new row, per "Sent versions are locked" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).
- Plain-text output with copy buttons, using the layout in [APP_FLOW.md](APP_FLOW.md).

## Phase 5: Job postings and AI
Goal: the full flow in APP_FLOW.md. Needs the Anthropic API key.

1. **Job posting:** fetch and extract a posting from a url, with the paste-in fallback, and let the user correct the result.
2. **Suggestions**, one step at a time, per the AI integration notes in [TECH_STACK.md](TECH_STACK.md): the posting's header (headline from the job title), starting point, sections, each section's content, rewordings (saved as new rows), and the cover letter's greeting.
3. **Writing rules:** code check for banned terms, Claude for judgment calls and patterns, and the tone set.
4. **Final review** of the resume and cover letter together.
5. **Cost check:** measure real API usage against the estimate in TECH_STACK.md.

## Phase 6: Polish
- Fix rough edges found while using the app for real applications.
- Make past versions easy to browse and reuse.
