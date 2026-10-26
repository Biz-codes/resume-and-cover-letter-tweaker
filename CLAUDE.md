# Resume and Cover Letter Tweaker

An app that takes a job posting url and helps the user build a tailored resume and cover letter, section by section, from content stored in a Postgres database. See [README.md](README.md) for the overview.

Purpose: replace tailoring resumes in AI chat with an app that saves every version, so each new application builds on the best earlier work instead of starting over. Favor designs that preserve and reuse past work.

Guiding principle: the app and AI do most of the heavy lifting (extracting, matching, suggesting, rewording), but the user has final control. The app suggests and the user decides. Nothing is added, changed, saved over, or deleted without the user's approval.

Status: planning. The design lives in `docs/`; no application code yet. All planning questions in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) are decided; add new ones there if they come up.

## Which doc to read
- [docs/TECH_STACK.md](docs/TECH_STACK.md): Python/FastAPI, Postgres 18 (Homebrew) with SQLAlchemy and Alembic, React/TypeScript with Vite, project layout, Claude Opus 5.5 through the `anthropic` SDK, running locally. Read before setting up or adding to the codebase, and before writing any Claude API code.
- [docs/APP_FLOW.md](docs/APP_FLOW.md): job posting extraction, user flow, how suggestions are made. Read for any app logic or UI work.
- [docs/WRITING_RULES.md](docs/WRITING_RULES.md): banned filler/AI-speak and tone rules. Read before writing anything that generates or reviews resume/cover letter text.
- [docs/DATABASE.md](docs/DATABASE.md): every table, column, and relationship. Read before writing schema, migrations, or queries.
- [docs/API_ERRORS.md](docs/API_ERRORS.md): error response shape, error codes, transactions, and how the front end handles failures. Read before writing any API endpoint or front end code that calls one.
- [docs/FRONTEND_CHECKS.md](docs/FRONTEND_CHECKS.md): rules the database doesn't enforce. Read before building anything that adds, suggests, or deletes data.

## Project skills and hooks
- `/db-table`: add or change a table in docs/DATABASE.md following the conventions below, and update the dependent docs.
- `/seed-resume`: translate an existing resume (PDF or pasted text) into INSERT statements in `db/seed_personal.sql` (gitignored).
- Hooks in `.claude/settings.json`: a PreToolUse hook blocks access to `.env` files; a PostToolUse hook runs `ruff` on edited Python files and `tsc` on edited TypeScript files once those tools are installed.

## Conventions
- The docs are the source of truth. When the design changes, update the relevant doc in the same change.
- Every API error uses the shape and codes in docs/API_ERRORS.md. Every write runs in one transaction, so a failed request changes nothing. When adding an app-side check, name the error code it returns.
- App-side checks are documented in two places on purpose: as a note under the table in DATABASE.md, and in FRONTEND_CHECKS.md. Add new ones to both.
- DATABASE.md tables use the columns `Column | Type | Constraints | Description` with aligned pipes. Descriptions follow set patterns: "unique X id", "id of related X", "date/time X added to db", "date/time X last updated".
- Users have full flexibility: any kind of content can go in any section (including mixes), and any section in any resume or cover letter. Cover letters have the same join tables as resumes. A library item's required `section_id` is only its home section, used to rank suggestions. Never use section titles for logic.
- The five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") and the built-in "Other" skill category (id 1) have fixed ids and no `account_id`. They can't be deleted or renamed.
- Every top-level table has an `account_id` (built-in sections and the "Other" skill category leave it empty). There's one account for now, but always scope queries to the current account so multiple accounts can be added later.
- Library tables have `created_at` and `updated_at`; database triggers keep `updated_at` current. Join tables have no timestamps; changing a selection updates the parent resume's or cover letter's `updated_at`.
- Join tables under resume/cover letter have their own `SERIAL` id (so child selections can reference them), a `position` column, and a `Unique:` line.
- A resume or cover letter with no `job_posting_id` is a base version: an ongoing starting point that can be edited directly. Versions tied to a posting are never edited to fit a different posting. Copy them instead.
- Every foreign key uses `ON DELETE CASCADE`, except `based_on_resume_id` / `based_on_letter_id`, `tone_set_id` on `resume` / `cover_letter`, and `sign_off_id` on `cover_letter`, which use `ON DELETE SET NULL`, and `skill.category_id`, which uses `ON DELETE SET DEFAULT` to move skills to "Other". The front end warns before deletes.
