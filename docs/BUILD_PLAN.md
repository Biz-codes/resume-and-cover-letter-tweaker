# Build Plan

The order for building the app, starting from the finished design docs. Each phase ends with something that works and can be tried. Check items off as they're done, and adjust the plan here if it changes.

## Before starting (user)
- [ ] **Anthropic API key** (needed by phase 5, not before): create an Anthropic Console account, add billing (separate from a Claude.ai subscription), and create a key. It goes in `backend/.env` as `ANTHROPIC_API_KEY=...`.
- [x] **Existing resumes** (needed by phase 2): have them ready as PDFs or text to paste.

Claude can't read or write `.env` files (a hook blocks it), so the user creates `backend/.env` by copying `backend/.env.example` and filling in the values.

## Environment notes
- **Installed:** Python 3.14, Node 24, npm, git, and PostgreSQL 18 from Homebrew (`brew services`), on port **5433** with no password for the Mac user. Use its tools by full path, e.g. `$(brew --prefix postgresql@18)/bin/psql -p 5433`.
- **Old Postgres 14** (EnterpriseDB installer, `/Library/PostgreSQL/14`) still runs on port 5432 and starts with the Mac. The app doesn't use it.
- **Not installed and not needed:** Docker, uv, gh.
- **Claude Code hooks:** after each edit, `ruff` runs from `backend/.venv`, and `tsc -b` and `oxlint` run in `frontend/`. The full list of hooks is in [CLAUDE.md](../CLAUDE.md).

## Phase 1: Project setup (done)
Goal: an empty app that runs, with the full schema in a real database.

1. [x] **Backend skeleton** in `backend/`:
   - Create a virtual environment at `backend/.venv` and install `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `psycopg`, `pydantic-settings`, `anthropic`, `httpx`, `beautifulsoup4`, `pytest`, and `ruff`. Record them in a requirements file.
   - Add a FastAPI app with a health-check endpoint, and settings that read `backend/.env`.
   - Add a committed `backend/.env.example` listing `DATABASE_URL`, `TEST_DATABASE_URL`, and `ANTHROPIC_API_KEY` with placeholder values.
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

## Phase 2: Seed personal data (done)
Goal: the user's real resume and cover letter content in the database. Done for Tech base, the Neptune resume, and the Neptune cover letter; more can be seeded the same way at any time.

1. [x] The user provides each existing resume or cover letter, one at a time. Use `/seed-resume` to translate it into its own file in `db/seed_personal/` (gitignored), reusing anything already in the library.
2. [x] Run each file once, before translating the next one, so the next one can match against it. After the first, run `db/seed_defaults.sql`.
3. [x] Check the result with the user: each seeded resume and cover letter should reproduce the original.

## Phase 3: Library management (done)
Goal: the user can view and edit all their content in the app.

Build it one table at a time: each one's API endpoints, page, and tests together.
1. [x] **API groundwork:** the current account (created with the defaults if none exists), looking up an item by id within the account, the API conventions in [TECH_STACK.md](TECH_STACK.md), and front end routing with a page per library table.
2. [x] **Headers**, including saving a new header when a sent version uses the one being edited.
3. [x] **Sections, skill categories, and skills**, with their child lists, the built-in protections, and the move to "Other".
4. [x] **Experience, projects, and bullet points**, with role versions and shared bullets.
5. [x] **Education, narrative content, writing rules, tone sets and rules, and sign-offs.**

What the pages cover:
- Pages to create, edit, and delete: headers (name, headline, contact details), sections, skill categories and skills, experience, projects (with their skills), bullet points, education, narrative content, writing rules, tone sets and rules, and sign-offs.
- Edit each parent's list of children (a section's items, a category's skills, a role's or project's bullets), show items no parent lists, and handle header and role versions, per [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).
- Delete warnings, built-in protections, and the skill category move to "Other", per [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

## Phase 4: Building resumes and cover letters by hand (done)
Goal: the full resume and cover letter tree works without AI.

Build it in steps, each with its API endpoints, pages, and tests together:
1. [x] **Resumes and cover letters:** list them (base versions, then ones for postings), show each as plain text with copy buttons, create base versions with the default header (and a letter's greeting and sign-off), edit their details, copy one to a new base version (the whole tree), and delete, with sent versions locked except for their name.
2. [x] **Building the tree:** add, remove, and reorder sections, the items in each section (mixed kinds, one order), a category's and project's skills, and a role's or project's bullets, with the warning before editing a base version. Write new bullets and narrative content in place.
3. [x] **Job postings by hand:** create and edit a posting from a pasted description, pick its header, and start its resumes and cover letters from a copy or fresh, each using the posting's header, which is changed only on the posting and reaches all of them.
4. [x] **Tracking and locking:** applied, rejection, and hire dates, contacts, and interviews shared across postings. Recording the applied date locks the posting's versions; clearing it warns first.

What the steps cover:
- Create base resumes and cover letters, add sections, and add any library items in any order, including mixed sections and the nested skills and bullets.
- Create a job posting by hand (pasted description) and pick its header. Create resumes and cover letters under it, each using the posting's header. Resumes and cover letters aren't linked to each other directly.
- Copy a version and warn before editing a base version.
- Record the applied date on a posting (plus rejection and hire dates, contacts, and interviews, which can be shared across postings), which locks its resumes and cover letters; editing a library item a locked version uses saves a new row, per "Sent versions are locked" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).
- Plain-text output with copy buttons, using the layout in [APP_FLOW.md](APP_FLOW.md).

## Between phases 4 and 5: reorganize the front end (done)
Goal: the front end is grouped by feature, with each component's styles beside it, before phase 5 adds the AI pieces. Nothing a user sees or does changes.

- [x] **Start only after the user has approved all of phase 4** (every step above checked off, and the user saying so). Ask before starting, and present the planned file moves for approval first.

What to do:
1. **Feature folders** in `frontend/src/` instead of `components/` and `pages/` (the layout Bulletproof React recommends for apps this size):
   - `shared/`: components and hooks more than one feature uses (`OrderedList`, `MoreOptions`, `Disclosure`, `FieldsForm`, `NameForm`, `Checklist`, `ConfirmDelete`, `HeaderFields`, `useFocusLater`, `usePageTitle`) and the API modules more than one feature reads (`client.ts`, `usage.ts`, `documents.ts`, and every library table's but `writingRules.ts`).
   - `library/`: the library pages (`LibraryPage` and one per table), the components only they use (`Collapsible`, `NameList`, `UsedBy`, `BulletList`, `ApplyChoice`), and `writingRules.ts`.
   - `postings/`: `PostingsPage`, `PostingPage`, `StartVersion`, `Tracking`, `Interviews`, and `postings.ts`.
   - `documents/`: `DocumentsPage`, `DocumentPage`, `DocumentTree`, `AddContent`, `LetterParts`, and `treeItems.ts`.
   - `App.tsx`, `main.tsx`, `modes.ts`, `HomePage.tsx`, `index.css`, and `test/` stay at the top. Where a component ends up used by only one feature, it goes in that feature; where a feature's component is used by another, it goes in `shared/`.
   - Move `LIBRARY_PAGES` out of `LibraryPage.tsx` into its own file in `library/` while there (question 14 in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md); mark it decided).
   - A component gets its own subfolder only if it has three or more files (e.g. once it has a `.module.css`); otherwise its `.tsx` and `.test.tsx` sit side by side in the feature folder.
2. **CSS Modules:** move styles used by one component from `index.css` into a `Name.module.css` beside it. `index.css` keeps what's site-wide: the colors, base element styles, layout and breakpoints, and shared classes (`muted`, `tag`, `actions`, `card`, `visually-hidden`, and the like).
   - Keep every color in `index.css`, as CSS custom properties that modules use, so the contrast check in `frontend/a11yChecks.ts` (which reads only `index.css`) still covers every color. Or extend the check to read the module files too.
3. **Move with `git mv`**, so each file keeps its history, and update every import. Tests change only in their import paths.
4. **Update every reference to the old paths:** "Project layout and tooling" and "API conventions" in [TECH_STACK.md](TECH_STACK.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), CLAUDE.md, the skills in `.claude/skills/`, and code comments (search for `components/`, `pages/`, and `api/`). The `a11y_review.py` hook and the sibling-test rule in `a11yChecks.ts` work with any folder layout.
5. **Check:** `scripts/check.sh`, then `/a11y` over the whole front end, then try every page in the browser to confirm nothing looks or behaves differently.

## After the reorganize: one dialog to edit each item
Goal: every item is edited the same way wherever it appears. Lists are changed where they're shown (a role's bullets are reordered, added, and removed on the role), and an item itself only in its own dialog, which every place it appears opens with the same Edit button.

- [x] **Start after the user approves this plan.** Build it in the steps below, each with its tests, and check each off.

Decided with the user:
- **The dialog holds the item and where it's used:** its fields with Save, New version, Delete, its own lists (a role's bullets, a category's skills, a project's skills and bullets, a section's lists), the sections that list it, and Used by. Library cards slim down to the title, a short summary, and Edit.
- **The same actions for every kind:** Edit, New version (a copy listed right after the original, as roles and projects have now), and Delete, for headers, sections, narrative content, skill categories, skills, roles, projects, bullets, education, sign-offs, and tones. Built-in sections and "Other" still can't be renamed or deleted.
- **Library and the resume and cover letter tree:** each row in the tree has Edit too, opening the same dialog. There, New version takes the item's place in that document only, as it does now.
- **One dialog at a time, never one inside another:** a name of another item inside the dialog (a bullet under a role, a role that lists a bullet) opens that item in the same dialog, with "Back to [the item before]" at the top; Close returns focus to where the dialog was first opened. Names shown on the pages open the dialog the same way. Names of resumes and cover letters (in Used by) stay links to their pages.
- **Hide instead of deleting what a sent application uses:** a sent application always keeps its record, so an item one uses can't be deleted (`VERSION_LOCKED`, with a message pointing to Hide), and its dialog offers Hide in place of Delete. Deleting the sent application itself, or its posting, still works after its warning. This replaces "Deleting is still allowed" in "Sent versions are locked" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).
- **Any item can be hidden,** used or not, to set it aside without losing it. A hidden item isn't offered anywhere new (pickers, More options, defaults, the library's lists), but every resume and cover letter that already shows it keeps it, sent or not. Built-in sections and "Other" can't be hidden, since every account shares them.
- **Each library page ends with "Hidden (n)",** closed to start, listing its hidden items with Unhide and View and Edit.
- **Accessibility:** a native modal `<dialog>` named by its heading, with focus moved to the heading when it opens or shows another item, Escape and Close to close it, focus returned to the button that opened it, and nothing behind it reachable while it's open.

Steps:
1. [x] **`Dialog`** in `frontend/src/shared/components/`: the modal, its focus handling, and its tests. The alert dialogs step below reuses it.
2. [x] **New version for every kind in the library:** a `POST /api/<items>/{id}/versions` like roles and projects have, for the kinds without one, each listed right after the original and listing the same children. Names and titles must be new (`DUPLICATE`).
3. [x] **The item dialog,** one shell with each kind's contents, opened from the library cards, which slim down.
4. [x] **Names open the dialog** everywhere they're shown, with Back inside it.
5. [x] **Hide:** a `hidden` column on each library table (through `/db-table`), Hide and Unhide in the dialog, hidden items left out of every list that offers items to add and out of the defaults, the "Hidden (n)" group on each page, and deletes refused while a sent application uses the item.
6. [x] **The resume and cover letter tree:** Edit on each row, with New version from the dialog taking the item's place in that document.
7. [x] **Docs:** APP_FLOW.md, FRONTEND_CHECKS.md, and TECH_STACK.md describe the pattern, then `/a11y` over the whole front end.

## After the item dialogs: status notices as alert dialogs
Goal: the success notices that now show as text on the page (the `role="status"` line under each page's heading, such as "Saved the posting." or "Header saved.") show as alert dialogs instead, so they don't stay on the page.

Decided with the user:
- **Every page notice** becomes an alert dialog: the message and OK. The page's `role="status"` line goes away.
- **It stays until closed,** with OK or Escape. It never closes on its own.
- **Errors stay where they are,** next to the field or form that failed, which stays open to fix.
- **Notices inside an item dialog stay there,** as its own notice line, since one dialog never opens inside another. A change that closes the item dialog shows its notice in an alert dialog once it's closed, as now.
- **Lists keep their own announcements** (`OrderedList`'s live region): they aren't page notices.

Accessibility (WCAG 2.2 AA): a modal `<dialog role="alertdialog">` named by its message, with focus on OK when it opens, so the message is read once (nothing else announces it). Tab stays on OK. When it closes, focus goes where the change would have sent it (the page heading after a delete, the row's View and Edit after a change from the tree), or back to where it was. A new notice while one is open replaces it and is read again.

Steps:
1. [x] **`AlertDialog`** in `frontend/src/shared/components/`, with its tests, and `useFocusLater` holding a focus move made while an alert dialog is open until it closes.
2. [x] **Every page** shows its notice in `AlertDialog` instead of the status line, and the tests that checked the status text check the alert dialog and close it.
3. [x] **Docs:** "Messages" under "Accessibility" in [TECH_STACK.md](TECH_STACK.md), the `/a11y` checklist, and anything else that mentions the page's status line, then `/a11y` over the whole front end.

## Phase 5: Job postings and AI
Goal: the full flow in APP_FLOW.md. Needs the Anthropic API key.

1. [x] **Job posting:** fetch and extract a posting from a url, with the paste-in fallback, and let the user correct the result. (The user still to try it with real postings, which needs the API key.)
2. **Suggestions**, one step at a time, per the AI integration notes in [TECH_STACK.md](TECH_STACK.md): the posting's header (headline from the role title), starting point, sections, each section's content, rewordings (saved as new rows), and the cover letter's greeting. They replace the "last used" defaults in `backend/app/defaults.py`, filling the same lists, with the rest under "More options". Add a "Build from scratch" choice that starts a document with no defaults (empty lists sent explicitly).
   - **Workshopping with Claude at every level:** a chat beside each New version form (and the add forms) to work on that piece with Claude, and at the top a review of the whole document; see "Working with Claude at every level" in [APP_FLOW.md](APP_FLOW.md). Suggestions may be new text never used before, saved as new rows only when accepted. Design the details when this step starts.
3. **Writing rules:** code check for banned terms, Claude for judgment calls and patterns, and the tone.
4. **Final review** of the resume and cover letter together.
5. **Cost check:** measure real API usage against the estimate in TECH_STACK.md.

## Phase 6: Release
Goal: a public demo that potential employers can try online: a real login, plus a "Try the demo" button that opens a demo account full of made-up data. Styling doesn't need to be finished.

- [ ] **Start once the user says the MVP is ready** (phase 5's flow working end to end). Confirm the choices below with the user first, and record them in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (questions 15 to 18) and the docs they affect.

Recommended (to confirm):
- **The user's own data stays local.** The hosted site holds only demo data. The user keeps running the app on their machine for real applications, so no personal data, `db/seed_personal/`, or sent resumes go online. Moving the user's own account online can come later, since logins will already exist.
- **Each visitor gets their own copy of the demo.** "Try the demo" creates a new account and copies the demo data into it, so visitors can add, edit, and delete freely without changing what the next visitor sees. Demo accounts are deleted after a set time (e.g. 24 hours). Every query is already scoped to the current account, so this mostly reuses what's built.
- **Logins with server-side sessions.** An email and password for the owner (no public sign-up), with passwords hashed with Argon2 (`pwdlib` or `argon2-cffi`), and a session id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, checked against a `session` table. No tokens kept in the browser. `current_account_id` in `backend/app/account.py` reads the session instead of taking the first account, so no endpoint changes.
- **One web service and one database.** FastAPI serves the built React files as well as the API, from the same address, so the cookie works without CORS. The database is a managed Postgres (matching version 18, if the host offers it). A host that deploys from GitHub and gives HTTPS by default, such as Render, Railway, or Fly.io; pick one when the phase starts, by price and Postgres version.
- **Limits on what the demo can cost.** Demo visitors' Claude requests use the user's API key, so: a cap on Claude requests per demo account and per day across all of them (a new error code, such as `LIMIT_REACHED`, through `ask` in `backend/app/claude.py`), and a monthly spend limit set in the Anthropic Console as a backstop.

Steps:
1. [ ] **Accounts and logins** (backend): add login columns to `account` and a `session` table through `/db-table` (with a `demo` flag and an expiry for demo accounts), endpoints to log in, log out, and get the current user, `current_account_id` reading the session, a new `UNAUTHENTICATED` error code in [API_ERRORS.md](API_ERRORS.md), a command-line script to create the owner's login, and limits on failed logins. Tests for each, and for one account never reaching another's items.
2. [ ] **Logins in the front end:** a sign-in page with "Try the demo", Sign out in the shell, and going to the sign-in page whenever a request returns `UNAUTHENTICATED`. Accessibility as usual (`/a11y`): labeled fields with `autoComplete` (`username`, `current-password`), errors read with their fields, and focus on the page heading after signing in or out.
3. [ ] **Demo data:** a committed seed of made-up content for a fictional person (a SQL file in `db/`, or Python that builds it): a library with a few roles, projects, skills, and bullets, a base resume and cover letter, and two or three job postings at different stages, one applied to (so its versions show as locked). Nothing from `db/seed_personal/`, and the text follows [WRITING_RULES.md](WRITING_RULES.md). `/check` confirms no personal data is in it.
4. [ ] **Demo accounts:** "Try the demo" creates an account, copies the demo data into it, and signs the visitor in. A short note on every page says it's a demo and when its changes are deleted. A cleanup job deletes expired demo accounts (on each new demo, or on a schedule), and the Claude limits above apply.
5. [ ] **Hardening for a public site:**
   - The posting reader fetches any address a visitor types, so block addresses inside the server's own network (`localhost`, private and link-local ranges, cloud metadata addresses), after redirects too, in `download` in `backend/app/posting_reader.py`.
   - Check the `Origin` header on every write (against cross-site requests), and add security headers (Content-Security-Policy, HSTS).
   - Settings for production: the database address, the session secret, the API key, and the allowed address, all from the host's environment variables, never committed.
   - Error responses never include stack traces or SQL.
6. [ ] **Deploy:** a production build (the React files built and served by FastAPI, or a `Dockerfile` if the host needs one), migrations run on each release, the demo seed loaded, a health check, and HTTPS on the host's address or a custom domain. Update "Running it" and the hosting rows in [TECH_STACK.md](TECH_STACK.md), and the README with the live link.
7. [ ] **Launch check:** try the demo as a visitor on a phone and a laptop, with a screen reader and with the keyboard alone; confirm the limits and the cleanup work; run `/check`; watch the API spend for the first week.

## Phase 7: Polish
- Fix rough edges found while using the app for real applications.
- Make past versions easy to browse and reuse.
