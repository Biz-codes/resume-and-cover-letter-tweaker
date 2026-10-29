# Tech Stack

| Layer     | Choice                                             |
|-----------|----------------------------------------------------|
| Backend   | Python with FastAPI                                |
| Database  | PostgreSQL 18, installed locally with Homebrew     |
| ORM       | SQLAlchemy, with Alembic for migrations            |
| Front end | React with TypeScript, built with Vite             |
| AI        | Claude Opus 5.5 through the `anthropic` Python SDK |
| Hosting   | Runs locally on the user's machine                 |

## Why
- **FastAPI:** a lightweight API framework for a separate React front end. It handles slow calls (fetching job postings, AI requests) well and generates API docs automatically.
- **SQLAlchemy + Alembic:** the standard Python tools for working with Postgres and tracking schema changes as migrations. The schema in [DATABASE.md](DATABASE.md) maps to SQLAlchemy models.
- **TypeScript:** resumes are deeply nested (resume → sections → items → skills and bullets). Types catch mismatches between the front end and the API early.
- **Local:** no hosting cost, the user's resume data stays on their machine, and no login system is needed. It can be deployed later if that changes.

## Project layout and tooling
- `backend/`: FastAPI app, SQLAlchemy models, Alembic migrations, tests. Python packages in a `venv` installed with pip.
- `frontend/`: Vite + React + TypeScript app.
- `db/`: seed SQL files (`seed_defaults.sql` and `seed_helpers.sql` committed; `seed_personal/`, one file per resume, gitignored).
- **Tests:** pytest for the backend, Vitest for the front end.
- **Linting:** ruff (Python), and tsc and oxlint (TypeScript, including oxlint's jsx-a11y accessibility rules), run automatically by a Claude Code hook after each edit.
- **Accessibility:** the front end targets WCAG 2.2 AA. See "Accessibility" below.

## Running it
Postgres 18 runs as a Homebrew service on port 5433 (see [BUILD_PLAN.md](BUILD_PLAN.md)). From `backend/`:
- `.venv/bin/alembic upgrade head`: apply migrations to the app database
- `.venv/bin/uvicorn app.main:app --reload`: start the API on port 8000
- `.venv/bin/pytest`: run the backend tests (against `TEST_DATABASE_URL`, whose schema they rebuild)
- `.venv/bin/alembic revision --autogenerate -m "..."`: create a migration after changing `app/models.py`

From the project root:
- `scripts/check.sh`: run every check (backend lint, tests, and schema drift; front end types, lint, and tests). The git pre-commit hook runs it too.

From `frontend/`:
- `npm run dev`: start the app at http://localhost:5173 (it forwards `/api` to the backend)
- `npm test`: run the front end tests

## API conventions
Every library table follows the pattern set by headers (`backend/app/routers/headers.py`, `frontend/src/pages/HeadersPage.tsx`):
- **Routes** live under `/api`, one router module per table in `backend/app/routers/`: `GET /api/<items>` lists, `GET /api/<items>/{id}` gets one, `POST` creates (201), `PUT /api/<items>/{id}` replaces the editable fields, and `DELETE` removes (204).
- **The current account:** endpoints take `AccountId` from `backend/app/account.py`, which creates the account with its defaults on first use. Look items up with `get_owned`, which returns `NOT_FOUND` for missing items and for other accounts' items alike.
- **Input:** request bodies use the field types in `backend/app/schemas.py`: text is trimmed, blank optional fields are saved as empty (null), and lengths match the columns, so bad input returns `VALIDATION_FAILED` naming the field.
- **Responses** include what the delete warning needs (e.g. `used_by`, with `locked` for sent versions), so the page doesn't need extra requests. `backend/app/usage.py` finds the resumes and cover letters that use an item, through each join table that can reach it, or through their own column for a tone set or sign-off (`column_uses`).
- **Names and lists:** `backend/app/library.py` checks unique names and the ids sent in a list, and edits a parent's ordered list of children (`PUT /api/<items>/{id}/<children>` replaces the whole list, in order). Built-in parents are shared, so their lists are always narrowed to the current account's children. `backend/app/refs.py` reads a list from either end (a role's bullets, the sections that list a role) as short refs for responses.
- **Built-in rows:** refer to the built-in sections and "Other" by their fixed ids, never by title: the constants in `backend/app/models.py`, and in the front end `BUILT_IN_SECTION_IDS` (`frontend/src/api/sections.ts`) and `OTHER_CATEGORY_ID` (`frontend/src/api/skills.ts`).
- **Item versions:** roles and projects have `POST /api/<items>/{id}/versions`, which adds a version sharing the original's lists, and their `PUT` takes `apply_to_unsent` (the user's answer to whether resumes and cover letters in progress get the change; see "Changing a role or project" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).
- **Versions:** a write that would change a sent version saves a new row instead (see "Sent versions are locked" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)); the response is the row that was saved, so a different id tells the page a new row was made. `backend/app/versions.py` has the lock condition, and `switch_unsent` in `usage.py` moves unsent versions to the new row.
- **Resumes and cover letters:** their join tables mirror each other, so `backend/app/documents.py` describes each kind's tables once (`RESUME`, `COVER_LETTER`), and the same code reads a document's tree (`load_tree`) and copies it (`copy_tree`). `/api/resumes` and `/api/cover-letters` take the same requests, and a document's `GET` includes its plain-text output. In the front end, `docsApi(kind)` (`frontend/src/api/documents.ts`) gives both one shape, and the same pages (`DocumentsPage`, `DocumentPage`) show either kind.
- **Front end:** each table has a typed module in `frontend/src/api/` and a page in `frontend/src/pages/`, with a route under `/library` in `frontend/src/App.tsx` and an entry in `LIBRARY_PAGES` (`frontend/src/pages/LibraryPage.tsx`), which lists it in the library's sub-nav and landing page. A new mode goes in `frontend/src/modes.ts`. Pages keep the user's input on errors, highlight the failing field, and list what a delete affects before confirming, using the shared pieces in `frontend/src/components/` (`UsedBy`, `ConfirmDelete`, `NameForm` for one field, `FieldsForm` for several, `OrderedList`, `BulletList`, `NameList`, `Collapsible`). Everything in a library card below its title (lists, "Used by") goes in a `Collapsible`, which shows a count and starts open unless it's empty. Tests stub the API with `frontend/src/test/stubApi.ts`.

## Accessibility
Every component and page is accessible and tested for it from the start, in three layers. Every test run (all files, one file, or a watch-mode rerun) runs the first two:
- **Whole-front-end checks** (`frontend/a11yChecks.ts`, Vitest global setup) stop the run before any test if a `.tsx` file has no sibling `.test.tsx`, if oxlint's jsx-a11y rules fail, or if a text color in `index.css` is below 4.5:1 contrast (axe can't measure contrast in jsdom). The jsx-a11y rules (`frontend/.oxlintrc.json`) are all errors except `prefer-tag-over-role`, which is off because `role="status"` is announced more reliably than `<output>`.
- **axe-core in the tests** (`frontend/src/test/axe.ts`): `src/test/setup.ts` runs axe after every test that rendered something, so every front end test is an accessibility test. Tests call `expectNoA11yViolations()` themselves for states they pass through before the end, so every state gets checked: loading, loaded, empty, load error, form open, saving, validation error, delete confirm. `App.test.tsx` checks each route as a whole page (landmarks, one `h1`).
- **Review:** the `/a11y` skill covers what tools can't: focus, keyboard use, announcements, and names that make sense out of context. It reviews the whole front end each time, not just the change, since a change in one place often affects others. A Claude Code Stop hook asks for it whenever a turn changed front end files.

Patterns the pages follow:
- **Focus:** a form or delete confirm that opens in place takes focus: the first field, or Cancel. When it closes, focus goes back to the button that opened it (`useFocusLater` in `frontend/src/hooks/`), or to the page heading after a delete. Moving to another page focuses that page's heading (the shell in `App.tsx` does this), so every page's `h2` has `id={PAGE_HEADING_ID}` and `tabIndex={-1}`.
- **Names:** buttons repeated on every card name their item (`aria-label='Delete "Freelance"'`), starting with the visible text.
- **Messages:** errors use `role="alert"` and are linked to their field with `aria-describedby`. The page's `role="status"` notice is always rendered, so screen readers announce changes to it.
- **Disabled buttons:** a button that may have focus when it stops being available (Save while saving, Add with nothing picked) uses `aria-disabled` and ignores clicks, so focus isn't lost.
- **Reordering:** lists are reordered with `OrderedList`'s grip handle: drag it, or (keyboard) Space or Enter to pick up, ↑/↓ to move, Space or Enter to drop, Escape to put it back. A click without dragging picks the item up too, and the other rows offer "Move here", so no step needs dragging (WCAG 2.5.7). Each step is announced in the list's live region.
- **Pages:** each sets its tab title with `usePageTitle`. The shell has `header`, `nav`, and `main` landmarks; a mode with its own pages (the library) adds a second `nav`, named for the mode. A mode's main nav link is marked `aria-current="true"` on its sub-pages and `"page"` on its own landing page.

## AI integration
- **Direct API calls, not an agent.** The user flow is a fixed sequence, so the backend runs each step and makes one Claude request per step: extract the posting, suggest sections, suggest each section's content, suggest rewordings, review the whole thing.
- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), with effort set per step: lower for extracting a job posting, higher for rewording and the final review.
- **Structured responses:** each request defines the shape of the reply with a Pydantic model, so the app gets data it can use directly. For example, a skills suggestion comes back as an ordered list of `skill_id`s, each with a reason, ready to show for approval.
- **Streaming** for longer outputs (rewritten sections, the final review), so text appears as it's written.
- **Prompt caching:** the parts that stay the same across a session go first in every request and are cached: writing rules, library content, then the job posting. The step-specific request comes last.
- **Job posting extraction:** Python fetches the HTML, and Claude pulls out the job description, organization, role title, and values as structured data. If fetching fails, the user pastes the text in instead. Error handling for these and every other failure is in [API_ERRORS.md](API_ERRORS.md).
- **Writing rules:** a code check finds banned words, and Claude judges only the flagged ones (technical term or filler?), per [WRITING_RULES.md](WRITING_RULES.md).

### API key and cost
- API usage is billed separately from a Claude.ai subscription, through an Anthropic Console account.
- The key lives in a `.env` file read only by the backend (`ANTHROPIC_API_KEY`), and `.env` is in `.gitignore`. The React front end never sees the key; all Claude calls go through FastAPI.
- Rough estimate: well under $1 per application with caching. Measure real usage once the app runs.
