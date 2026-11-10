# Build Plan

The order for building the app, starting from the finished design docs. Each phase ends with something that works and can be tried. Check items off as they're done, and adjust the plan here if it changes.

## Before starting (user)
- [x] **Anthropic API key** (needed by phase 5, not before): create an Anthropic Console account, add billing (separate from a Claude.ai subscription), and create a key. It goes in `backend/.env` as `ANTHROPIC_API_KEY=...`.
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

## Before phase 5 continues: one way to change an item (done)
Goal: every kind of library item changes the same way, the way roles, projects, bullets, and narrative content do now: edit it in its dialog, then check which other resumes and cover letters in progress get the change. "New version" goes away everywhere, so there's one way to change things and nothing extra to explain.

- [x] **Start after the user approves this plan.** Build it in the steps below, each with its tests, and check each off.

Decided with the user:
- **Every kind:** sections, skill categories, skills, education, sign-offs, tone sets, and headers get the checklist too ("Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md) becomes the rule for every item).
- **Tones too,** though they aren't printed, so a sent resume keeps the tone it was written with and the user can go back to it. A tone is saved whole (its name and its rules, in order) with one Save, instead of each rule change saving on its own. A tone saved from an edit keeps its name, and lists tell same-named tones apart by the date each was added, as they do roles and headers.
- **No New version button,** on tree rows or library pages. To keep two wordings side by side, the user writes the second as new content. A new row is still saved, listed right after the original, whenever an edit can't be made in place (a sent version uses the item, or not every one in progress is checked).
- **A short note above the fields** says what Save will do, whenever the item is opened from a resume or cover letter or something in progress uses it: "Saving changes it in this resume only.", "…in this resume, and in the others you check below.", or, from the library, "…only in the ones you check below; the rest keep it as it is." The note for a sent version stays.

Steps:
1. [x] **Backend, the other kinds:** move the `apply_to` handling the four kinds share into one helper, and use it for sections, skill categories, skills, education, sign-offs, tone sets, and headers. Unchecked ones keep the original, so an edit saves a new row unless every one in progress is checked. Edge cases:
   - A built-in section or "Other" can't be renamed, so a new title always saves a new section, which the checked ones switch to.
   - A header's checklist names the postings (whose resumes and cover letters all share its header) and the base resumes and cover letters that use it, in place of the rule that nothing switches to an edited header.
   - Tone sets: `PUT /api/tone-sets/{id}` takes the name, every rule in order (with its `tone_rule_id`, or none for a new rule), and `apply_to`; the one-rule endpoints are gone. A new name can't match another tone's (`DUPLICATE`); an unchanged one can.
2. [x] **Backend, removing New version:** the `POST /api/<items>/{id}/versions` endpoints and the tree's "new version in this item's place" path (`replaces` in `backend/app/routers/document_tree.py`), with their tests. An edit from a tree row already covers it: that document gets the change, and nothing else does unless it's checked.
3. [x] **Front end:** `ApplyChoice` and the note in every kind's dialog (a header's from its `in_progress`), the tone dialog editing its rules in the form until Save (tones told apart by date, `created_at`), New version taken out of `ItemParts`, every item view, `itemHost.ts` (`placed.version`, `placedNote`), and the API modules, with tests and `/a11y`.
4. [x] **Docs:** FRONTEND_CHECKS.md ("Changing an item" for every item, tones in "Writing rules" no longer edited in place, "Sent versions are locked", "Headers", "Item dialogs", and "New versions in a resume or cover letter" removed), the DATABASE.md notes, APP_FLOW.md, TECH_STACK.md ("Item versions"), and README.md, then `/check`.
5. [x] **A resume's or cover letter's page, edited in place** (asked for during step 3): no "Edit this one" step, Rename, or Done editing. A base version, or one in progress, is edited right away, its name is changed under Contents with "New title", in a modal (a base version's title ends in "Base Resume", shown that way everywhere, so there's no "Base resume" line; name fields show the suffix beside them), and a note above Copy and Delete says what editing does. A sent one shows only its name to edit, with Copy and Hide (or Unhide): it can't be deleted (`VERSION_LOCKED`). Resumes and cover letters get `hidden`, with a "Hidden (n)" group on their list pages, and hidden ones aren't offered to start from.

## Alongside phase 5: show the project early
Goal: recruiters can see the project from its GitHub page before there's a live demo (phase 6). They read the README and watch a short video far more often than they sign in to try an app, and a live site needs logins and hardening first.

Steps 1 and 2 don't depend on phase 5, so do them before phase 5 continues. Step 3 waits until reviewing a suggestion works (phase 5 step 2, sub-step 2), since that's the part worth showing.

1. [x] **CI with GitHub Actions:** a workflow that runs the same checks as `scripts/check.sh` on every push and pull request, with a Postgres 18 service container for the backend tests, and a passing badge at the top of the README. `check.sh` looks for Homebrew's Postgres on port 5433 and a local `.venv`, so either it learns to run on the CI machine or the workflow runs the checks itself. It needs no secrets: nothing in it calls Claude or reads `db/seed_personal/`. Commits from VS Code's commit box skip the pre-commit hook, so CI also catches what they let through.
2. [x] **Demo data:** a committed seed of made-up content for a fictional person (a SQL file in `db/`, or Python that builds it): a library with a few roles, projects, skills, and bullets, a base resume and cover letter, and two or three job postings at different stages, one applied to (so its versions show as locked). Nothing from `db/seed_personal/`, and the text follows [WRITING_RULES.md](WRITING_RULES.md). `/check` confirms no personal data is in it. It loads into its own local database, so screenshots and recordings never show the user's real applications. Phase 6 reuses it for demo accounts. Built as `db/seed_demo.sql` (Riley Moreno, a front end engineer), loaded by `scripts/demo_db.sh` into `resume_tweaker_demo`; `backend/tests/test_seeds.py` checks it loads, reads through the API, lists every item under a parent, and follows the writing rules, and `scripts/check_demo_data.py` (run by `/check`) compares it with `db/seed_personal/`.
3. [ ] **Walkthrough and README:** with the demo data, a 2 to 3 minute recorded walkthrough (paste in a posting, see what's extracted, review Claude's suggestion, finish the resume, and show that every version is saved and reused) and a few screenshots or a GIF. The README opens with what the app does and why in a sentence or two, then the video, then what stands out in how it's built (accessibility tested in every state, structured Claude output checked before it's shown, docs checked against the code). The repo is public and pinned on the user's GitHub profile, and linked from their LinkedIn and resume (the user does these). Started: the README is reorganized this way (with commented-out places for the video and screenshots), and [WALKTHROUGH.md](WALKTHROUGH.md) has the recording's setup, a made-up posting to paste, the script, and the screenshots to save in `docs/images/`. Left for the user: recording, the screenshots, and the links.

## Phase 5: Job postings and AI
Goal: the full flow in APP_FLOW.md. Needs the Anthropic API key.

1. [x] **Job posting:** fetch and extract a posting from a url, with the paste-in fallback, and let the user correct the result.
2. **Suggestions and workshopping with Claude.** Built in the sub-steps below, each with its tests and docs (APP_FLOW.md, FRONTEND_CHECKS.md, and DATABASE.md through `/db-table` for any table), per the AI integration notes in [TECH_STACK.md](TECH_STACK.md).

   Decided with the user:
   - **One request when a posting's document is started.** Claude tailors it the way it would in chat: it reads the posting, picks the saved resume (or cover letter) that fits it best as the starting point, and goes through it. Where an item doesn't match the posting well, it looks in the library for a better one first. Then it makes minimal tweaks (keywords, emphasis) to align the content with the posting. Every rule in [WRITING_RULES.md](WRITING_RULES.md) applies, and the document's tone. Each choice comes with a short reason.
   - **The suggestion fills the tree, as a draft to review.** Nothing is saved to the document or the library until the user's first pass. Each row shows Claude's reason; where Claude reworded an item or wrote new text (sometimes a bullet is almost entirely Claude's), its wording is used, with the original noted and a way back to it. The user removes, swaps, and edits as usual.
   - **Finishing the first review saves it.** The document gets what the user kept. Claude's wordings the user kept become new library rows, listed right after their originals, used in this document only. Then, for any text Claude wrote that the user didn't use, the app asks whether to keep each in the library for later or discard it.
   - **No "Suggest again".** Instead, one chat panel beside the document, opened from "Ask Claude" on the whole document, each section, or each item, to workshop the suggestions with Claude. Changes it proposes follow the same rules: nothing is saved until the user applies them.
   - **Every new resume and cover letter**, base or for a posting, can also start by uploading an existing one (PDF or Word) or pasting its text in. A new base one starts one of four ways: from scratch (empty), upload, paste, or from a saved resume or cover letter. An upload or paste is split by Claude into library items, reusing the ones the library already has; the user reviews the list (marking what's new) and fixes anything before Save adds the new items and the document, the same idea as `/seed-resume`. On a posting, after that review the user chooses each time: keep it as is (one already sent or finished elsewhere), or have Claude tailor it to the posting from there, through the same draft review as sub-step 2.

   Sub-steps:
   1. [x] **The suggestion request** (backend): the prompt (writing rules, tone, the library, and earlier documents first, cached; then the posting and the step), a structured reply (the starting document, then the tree: sections, items, skills, and bullets by id, each with a reason, and reworded or new text with the id of the item it replaces), and checks that every id is the account's own and listed where Claude put it. Stored as a draft until it's reviewed, in a table designed with `/db-table`.
   2. [x] **Reviewing the draft** (front end and backend): starting a posting's document runs the request and opens the draft, with reasons and Claude's wordings (original noted, with a way back), then "Finish review", which saves the tree and the kept wordings as new rows, then asks keep or discard for Claude's unused text. The Start form also offers to copy a saved one as is, or to build from scratch (empty lists sent explicitly). The posting's header suggestion gets its headline from Claude here too: the job title only, never the organization.
      Decided with the user: the first pass is focused, not every tree control. On the draft the user removes, reorders, adds from More options (how an item is swapped), and switches between Claude's wording and the original, with Undo and Redo; Add content, New bullet, and View and Edit come back after Finish review, when a kept wording is used in this document only and so is edited in place. The headline needed nothing new: it already comes from the role title Claude pulls out when it reads the posting, without the organization. Built as `POST .../tailored` (the document and its draft in one transaction), `PUT .../draft`, and `POST .../draft/finish` (`backend/app/drafts.py`), and `DraftTree` on the document's page. Later changed with the user: the first pass only accepts or rejects Claude's suggestions (each row badged Original, Library, or Claude, with its reason under "Rationale"); reordering and More options were dropped, since adding and removing without editing was confusing, and "Finish review" became "Approve first draft".
   3. [x] **New documents from an existing one:** upload (PDF read by Claude directly, Word turned into text first) and paste, for resumes and cover letters, split into library items, matched against the library, reviewed, then saved. The New base form's four starts, and two more on a posting's Start form, each ending with the choice to keep it as is or have Claude tailor it. Built before chat (decided with the user), since the user is applying for jobs with the app now.
      Decided with the user: the review is a form where the user started, like reading a job posting, so nothing is saved (and no empty document is left) until Save; Claude names near matches (`similar_to`) and the user picks "Use the saved one" or keeps it as new, while identical items are found in code; the review fixes text and removes items, and reordering and adding happen afterward in the tree. Built as `POST .../read`, `POST .../imported`, and `POST .../imported/tailored` (`backend/app/imports.py`), and `ImportReview` and `SourceField` in the front end. The New base form keeps "Fresh, with the usual defaults" rather than an empty start, so its four starts are fresh, copy, upload, and paste.
   4. [ ] **Chat at every level:** one chat panel beside the document (full screen on a phone, with a way back to the document), not a box at each level, so the whole conversation builds on itself and the cached library and posting are reused. An "Ask Claude" button on the document, each section, and each item (named for its row) opens the panel about that part and moves focus to its text box; the panel shows what it's about, which can be widened to the section or the whole document. An item's dialog has its own "Ask Claude" section (a `Collapsible` under the item's fields), so the user can ask about an edit without leaving it: it knows the item, the posting, and the unsaved text, its replies are announced in the dialog's notice, and "Use this" on a suggested wording puts it in the field only, saved with the dialog's Save. Its exchange joins the document's one conversation, which the panel shows once the dialog closes (one modal never opens inside another). Claude proposes changes as cards in the chat, showing before and after, with Apply and Dismiss; Apply saves an ordinary change to the tree, with Undo, and Claude's new wording becomes a new library row used in this document only, as in sub-step 2. Design the rest (what the chat remembers between visits, and how replies are announced) when this sub-step starts.
   5. [ ] **Cover letter extras:** the greeting (a hiring manager's name when the posting gives one) and new paragraphs written from the posting, through the same draft review.

   The last-used defaults in `backend/app/defaults.py` stay for content added by hand afterward (a section added later), until sub-step 4 (chat) decides whether the chat replaces them.
3. **Writing rules:** code check for banned terms, Claude for judgment calls and patterns, and the tone.
4. **Final review** of the resume and cover letter together.
5. **Cost check:** measure real API usage against the estimate in TECH_STACK.md.

## Phase 6: Release
Goal: a public demo that potential employers can try online: a real login, plus a "Try the demo" button that opens a demo account full of made-up data. Styling doesn't need to be finished.

- [ ] **Start once the user says the MVP is ready** (phase 5's flow working end to end). Confirm the choices below with the user first, and record them in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (questions 16 to 19) and the docs they affect.

Recommended (to confirm):
- **The user's own data stays local.** The hosted site holds only demo data. The user keeps running the app on their machine for real applications, so no personal data, `db/seed_personal/`, or sent resumes go online. Moving the user's own account online can come later, since logins will already exist.
- **Each visitor gets their own copy of the demo.** "Try the demo" creates a new account and copies the demo data into it, so visitors can add, edit, and delete freely without changing what the next visitor sees. Demo accounts are deleted after a set time (e.g. 24 hours). Every query is already scoped to the current account, so this mostly reuses what's built.
- **Logins with server-side sessions.** An email and password for the owner (no public sign-up), with passwords hashed with Argon2 (`pwdlib` or `argon2-cffi`), and a session id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, checked against a `session` table. No tokens kept in the browser. `current_account_id` in `backend/app/account.py` reads the session instead of taking the first account, so no endpoint changes.
- **One web service and one database.** FastAPI serves the built React files as well as the API, from the same address, so the cookie works without CORS. The database is a managed Postgres (matching version 18, if the host offers it). A host that deploys from GitHub and gives HTTPS by default, such as Render, Railway, or Fly.io; pick one when the phase starts, by price and Postgres version.
- **Limits on what the demo can cost.** Demo visitors' Claude requests use the user's API key, so: a cap on Claude requests per demo account and per day across all of them (a new error code, such as `LIMIT_REACHED`, through `ask` in `backend/app/claude.py`), and a monthly spend limit set in the Anthropic Console as a backstop.

Steps:
1. [ ] **Accounts and logins** (backend): add login columns to `account` and a `session` table through `/db-table` (with a `demo` flag and an expiry for demo accounts), endpoints to log in, log out, and get the current user, `current_account_id` reading the session, a new `UNAUTHENTICATED` error code in [API_ERRORS.md](API_ERRORS.md), a command-line script to create the owner's login, and limits on failed logins. Tests for each, and for one account never reaching another's items.
2. [ ] **Logins in the front end:** a sign-in page with "Try the demo", Sign out in the shell, and going to the sign-in page whenever a request returns `UNAUTHENTICATED`. Accessibility as usual (`/a11y`): labeled fields with `autoComplete` (`username`, `current-password`), errors read with their fields, and focus on the page heading after signing in or out.
3. [ ] **Demo data:** bring the seed from "Show the project early" up to date with anything phase 5 added (drafts, chats), so a demo account shows every part of the app.
4. [ ] **Demo accounts:** "Try the demo" creates an account, copies the demo data into it, and signs the visitor in. A short note on every page says it's a demo and when its changes are deleted. A cleanup job deletes expired demo accounts (on each new demo, or on a schedule), and the Claude limits above apply.
5. [ ] **Hardening for a public site:**
   - The posting reader fetches any address a visitor types, so block addresses inside the server's own network (`localhost`, private and link-local ranges, cloud metadata addresses), after redirects too, in `download` in `backend/app/posting_reader.py`.
   - Check the `Origin` header on every write (against cross-site requests), and add security headers (Content-Security-Policy, HSTS).
   - Settings for production: the database address, the session secret, the API key, and the allowed address, all from the host's environment variables, never committed.
   - Error responses never include stack traces or SQL.
6. [ ] **Deploy:** a production build (the React files built and served by FastAPI, or a `Dockerfile` if the host needs one), migrations run on each release, the demo seed loaded, a health check, and HTTPS on the host's address or a custom domain. Update "Running it" and the hosting rows in [TECH_STACK.md](TECH_STACK.md), and the README with the live link.
7. [ ] **CD with GitHub Actions:** a workflow that deploys `main` to the host once CI (from "Show the project early") passes, with the host's deploy key in GitHub's encrypted secrets, never committed. Migrations run as part of the release, as in step 6. Note it in "Running it" in [TECH_STACK.md](TECH_STACK.md) and in the README.
8. [ ] **Launch check:** try the demo as a visitor on a phone and a laptop, with a screen reader and with the keyboard alone; confirm the limits and the cleanup work; run `/check`; watch the API spend for the first week.

## Phase 7: Polish
- Fix rough edges found while using the app for real applications.
- Make past versions easy to browse and reuse.

## Phase 8 (long term): a product for other job seekers
Goal: anyone can sign up, bring their own resumes, and pay for the app if it's worth it to them. An outline to plan in detail when the phase starts; the questions are in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (questions 20 to 24).

1. [ ] **Check there's demand:** use it for real applications first (phase 7), then put it in front of a handful of other job seekers and watch where they get stuck. Compare with the tools already out there (Teal, Jobscan, Rezi, Kickresume, Huntr, and others) and write down what this one does differently: every version saved and reused, the user approving every change, writing rules against AI-sounding text, and accessibility.
2. [ ] **Sign-up and onboarding:** public sign-up with email verification and password reset on top of phase 6's logins (every query is already scoped to the account). A new user's first step is uploading or pasting an existing resume (phase 5 step 2, sub-step 3), so the library fills itself.
3. [ ] **Real users' data online:** a privacy policy and terms of service, encrypted backups, exporting all of an account's data, and deleting an account and everything in it. Check the Anthropic commercial terms and usage policy for sending users' resumes to the API, and the privacy laws for where users live (GDPR, CCPA).
4. [ ] **What users take away:** formatted PDF and Word downloads that applicant tracking systems read well, since most users won't paste plain text into their own template (APP_FLOW.md says no export for now).
5. [ ] **Paying:** plans and limits set from phase 5's cost check (what one tailored application costs in API usage), billing through a payment provider such as Stripe, and Claude requests counted against each account's plan.
6. [ ] **Running it as a service:** error tracking, uptime monitoring, a support email, and a business set up to take payments (the user decides the legal side, such as an LLC).
7. [ ] **Launch:** a landing page with the walkthrough, and posts where job seekers and career coaches already gather.
