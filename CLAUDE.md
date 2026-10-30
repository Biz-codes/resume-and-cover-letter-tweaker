# Resume and Cover Letter Tweaker

An app that takes a job posting url and helps the user build a tailored resume and cover letter, section by section, from content stored in a Postgres database. See [README.md](README.md) for the overview.

Purpose: replace tailoring resumes in AI chat with an app that saves every version, so each new application builds on the best earlier work instead of starting over. Favor designs that preserve and reuse past work.

Guiding principle: the app and AI do most of the heavy lifting (extracting, matching, suggesting, rewording), but the user has final control. The app suggests and the user decides. Nothing is added, changed, saved over, or deleted without the user's approval.

Status: phase 1 (project setup) done; phase 2 (seed personal data) done: Tech base, the Neptune resume, and the Neptune cover letter are loaded (more can be seeded any time); phase 3 (library management) done; phase 4 (building resumes and cover letters by hand) in progress: steps 1 and 2 done. The design lives in `docs/`. All planning questions in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) are decided; add new ones there if they come up. **Start every build session with [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)**: work on the first unchecked item, check items off as they're done, and update this status line as phases finish.

## Which doc to read
- [docs/TECH_STACK.md](docs/TECH_STACK.md): Python/FastAPI, Postgres 18 (Homebrew) with SQLAlchemy and Alembic, React/TypeScript with Vite, project layout, API conventions, Claude Opus 5.5 through the `anthropic` SDK, running locally. Read before setting up or adding to the codebase, before adding an API endpoint or page, and before writing any Claude API code.
- [docs/APP_FLOW.md](docs/APP_FLOW.md): job posting extraction, user flow, how suggestions are made. Read for any app logic or UI work.
- [docs/WRITING_RULES.md](docs/WRITING_RULES.md): banned filler/AI-speak and tone rules. Read before writing anything that generates or reviews resume/cover letter text.
- [docs/DATABASE.md](docs/DATABASE.md): every table, column, and relationship. Read before writing schema, migrations, or queries.
- [docs/API_ERRORS.md](docs/API_ERRORS.md): error response shape, error codes, transactions, and how the front end handles failures. Read before writing any API endpoint or front end code that calls one.
- [docs/FRONTEND_CHECKS.md](docs/FRONTEND_CHECKS.md): rules the database doesn't enforce. Read before building anything that adds, suggests, or deletes data.

## Project skills and hooks
- `/db-table`: add or change a table in docs/DATABASE.md following the conventions below, and update the dependent docs.
- `/seed-resume`: translate an existing resume or cover letter (PDF or pasted text) into a SQL file in `db/seed_personal/` (gitignored), reusing library items that already exist instead of duplicating them. Sent versions are copied exactly as sent.
- **Suggest workflow improvements.** While working on the app, when a repeated task, a recurring mistake, or a manual step could be handled better by a new hook, skill, subagent, MCP server, or permission rule, suggest it to the user: say what it would do and why, in a sentence or two. Don't set it up without the user's approval.
- `/a11y`: review the whole front end for accessibility (WCAG 2.2 AA), not just what changed, since a change in one place often affects others; fix what it finds, and add axe-core checks and behavior tests for every state it renders.
- `/docs-audit` (run by the user when they choose): check every doc and code comment against the actual code, fix what's stale or missing, and ask about real disagreements.
- `/commit-message`: write a commit message for the staged changes only, at the length the user picks. It asks "What type of commit message do you want to add?": succinct (one line), highlights (a subject plus one line per significant change), verbose, or write my own. Never stages or commits.
- `/check`: run every automated check (`scripts/check.sh`), confirm nothing secret or personal would be committed, and sweep the docs for leftovers from design changes. Use before the user commits and after design changes.
- Hooks in `.claude/settings.json`:
  - A PreToolUse hook blocks access to `.env` files.
  - PostToolUse hooks run `ruff` on edited Python files, run `tsc` and `oxlint` (with jsx-a11y rules) on edited TypeScript files, and note edited front end components, pages, CSS, and tests.
  - A Stop hook (`.claude/hooks/a11y_review.py`) blocks the end of a turn that changed front end files until `/a11y` has reviewed the front end. Running `/a11y` clears the list of changed files (a PostToolUse hook on Skill), so the Stop hook only fires for changes made after the last review.
- Git hooks in `.githooks/` (turned on with `git config core.hooksPath .githooks`):
  - `pre-commit`: refuses to commit `.env` files, `db/seed_personal/`, or database dumps, then runs `scripts/check.sh`. A failing check blocks the commit.
  - `prepare-commit-msg`: on a plain `git commit` in a terminal, asks the same question (1 succinct, 2 highlights, 3 verbose, or 4 write my own, the default). For 1 to 3, `claude -p` runs `/commit-message` on the staged changes with read-only git tools, and the editor opens with the message to review. Skipped for `-m`/`-F`, merges, amends, nothing staged, and commits without a terminal (such as VS Code's commit box).

## Conventions
- The docs are the source of truth. When the design changes, update the relevant doc in the same change.
- `backend/tests/test_docs.py` checks DATABASE.md against the models (and API_ERRORS.md against the backend and front end error codes), and `test_migrations.py` checks the models against the migrations. A schema change that skips the docs or a migration fails the tests.
- Every API error uses the shape and codes in docs/API_ERRORS.md. Every write runs in one transaction, so a failed request changes nothing. When adding an app-side check, name the error code it returns.
- App-side checks are documented in two places on purpose: as a note under the table in DATABASE.md, and in FRONTEND_CHECKS.md. Add new ones to both.
- DATABASE.md tables use the columns `Column | Type | Constraints | Description` with aligned pipes. Descriptions follow set patterns: "unique X id", "id of related X", "date/time X added to db", "date/time X last updated".
- Users have full flexibility: any kind of content can go in any section (including mixes), and any section in any resume or cover letter. Cover letters have the same join tables as resumes. Never use section titles for logic.
- The five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") and the built-in "Other" skill category (id 1) have fixed ids and no `account_id`. They can't be deleted or renamed.
- Every top-level table has an `account_id` (built-in sections and the "Other" skill category leave it empty). There's one account for now, but always scope queries to the current account so multiple accounts can be added later.
- Library tables have `created_at` and `updated_at`; database triggers keep `updated_at` current. Join tables have no timestamps; changing a selection updates the parent resume's or cover letter's `updated_at`.
- Library items stand alone and store no parent id. Each parent lists its possible children in a library join table (`section_experience`, `experience_bullet_point`, `skill_category_skill`, etc.) with a `position` for default order and a (parent, child) primary key. One child can be listed under many parents. These lists drive suggestions; they don't limit where an item can go.
- Join tables under resume/cover letter have their own `SERIAL` id (so child selections can reference them), a `position` column, and a `Unique:` line.
- A resume or cover letter with no `job_posting_id` is a base version: an ongoing starting point that can be edited directly. Versions tied to a posting are never edited to fit a different posting. Copy them instead. Once the posting's `applied_on` date is set, its versions are locked (`VERSION_LOCKED`), and library edits that would change them save a new row instead.
- Accessibility is part of every front end change, not a later pass: target WCAG 2.2 AA, and give each `.tsx` file a sibling `.test.tsx` whose tests reach every state it renders. Every test run checks a11y: `frontend/a11yChecks.ts` (test coverage, jsx-a11y lint, contrast) runs first, axe runs after every test, and tests call `expectNoA11yViolations()` for states they pass through. See "Accessibility" in [docs/TECH_STACK.md](docs/TECH_STACK.md).
- Every foreign key uses `ON DELETE CASCADE`, except `based_on_resume_id` / `based_on_letter_id`, `tone_set_id` on `resume` / `cover_letter`, `header_id` on `job_posting` / `resume` / `cover_letter`, and `sign_off_id` on `cover_letter`, which use `ON DELETE SET NULL`. Deleting a library parent (a section, skill category, role, or project) never deletes its children, only its list of them. The front end warns before every delete and lists what it affects.
