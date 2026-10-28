---
name: seed-resume
description: Translate one of the user's existing resumes or cover letters (a PDF path or pasted text) into SQL for a new file in db/seed_personal/, reusing library rows that already exist instead of duplicating them, following the schema in docs/DATABASE.md. Handles current base versions and ones already sent for a job posting. Use when the user wants to load an existing resume or cover letter into the database.
---

# Turn an existing resume or cover letter into seed SQL

Everything below applies to cover letters too (see "Cover letters" for what's different). "Resume" means either.

Each resume gets its own file in `db/seed_personal/`, named with the next number and the resume's name (e.g. `01_tech_base.sql`, `02_neptune.sql`). The folder is listed in `.gitignore` because it holds personal data. Never copy its contents into a committed file, a commit message, or a doc.

Each file is run once. Content that's already in the library is reused, not inserted again, so the library holds every role, project, bullet, sentence, and skill only once, and each resume just points to the items it shows.

## Before starting

1. **Read the schema.** Read `docs/DATABASE.md`. Table and column names change over time, so never work from memory. Library items store no parent ids: each parent lists its children in a library join table (`section_experience`, `experience_bullet_point`, `skill_category_skill`, etc.).
2. **Check the schema exists.** The seed must match the migrations. If the schema and `DATABASE.md` disagree, stop and tell the user.
3. **Ask what kind of resume it is**, if the user hasn't said:
   - **Base resume:** a current, ongoing starting point (no job posting). Ask for its name.
   - **Sent resume:** already submitted for a job posting. It's a record: copy it exactly as sent (see Rules). Ask for its name and the posting's url, and optionally the date it was sent (`applied_on`).
4. **Read what's already in the library**, from two places:
   - **The database:** query the library and library join tables with `$(brew --prefix postgresql@18)/bin/psql -p 5433 -d resume_tweaker`. This includes earlier resumes and anything the user changed in the app.
   - **Files not run yet:** any file in `db/seed_personal/` whose resume isn't in the `resume` table yet. If one exists, ask the user to run it first.

## Job posting (sent resumes)

Add a `job_posting` row with the `url`, `organization`, the posting's own `role_title`, and the full `description` text, so the posting can be read again after it's taken down.
- Fetch the posting. If the page renders with JavaScript, try the job board's JSON (e.g. BambooHR serves `<url>/detail`). Keep the full text, including the organization's description and values, as plain text.
- If it can't be fetched, ask the user to paste the description. Never invent or summarize it.
- Reuse an existing `job_posting` row with the same url instead of adding another.
- Set the posting's `header_id` to the header the sent resume or letter shows (`pg_temp.header(...)`).
- Set `resume.job_posting_id` to it, and give the resume the posting's `header_id` (unless it was sent with a different header).

## Matching against the library

For every item in the resume, look for the same item in the library before adding it. Items are matched on their own text only, never on where they're listed.

| Item               | Same item when                                                                              |
|--------------------|---------------------------------------------------------------------------------------------|
| Header             | same name, headline, and every contact detail and link                                      |
| Section            | same title (or the matching built-in section)                                               |
| Skill category     | same name                                                                                   |
| Skill              | same name                                                                                   |
| Experience         | same role title, organization, location, and dates                                          |
| Project            | same title, done for, url, and dates                                                        |
| Education          | same degree, institution, details, and graduation                                           |
| Bullet point       | same text                                                                                   |
| Narrative sentence | same text                                                                                   |

Only spacing is ignored. Any other difference, even one character, is a different item.

- **Exact match:** reuse the existing row. The new resume's join rows point to it.
- **New item:** insert it.
- **Versions of a role, project, or education entry:** when a resume shows a role with a different title, dates, or location than the library has, that's a separate `experience` row, a version of the role. Versions list the same bullets, so shared bullets are never stored twice.
  - **Sent resume:** add the new version without asking. It records what was sent.
  - **Base resume:** ask whether to add a new version, or update the existing row (every resume showing it changes).
- **Near matches** in names that look like the same thing written differently ("Acme Corp" / "Acme Corporation", "JS" / "JavaScript"): for a base resume, ask whether it's the same item. For a sent resume, copy it as written and point it out.
- **Bullets or sentences that differ slightly** are separate rows (alternate wordings are what the library is for). Point them out.

## Library lists

Every item the resume uses, new or reused, must be listed under its parent. Add the list row if it isn't there yet, at the end of the list (`MAX(position) + 1`), and skip it if it is (`ON CONFLICT DO NOTHING`):
- the section it appears in: `section_narrative_content`, `section_skill_category`, `section_experience`, `section_project`, `section_bullet_point` (bullets directly in the section), `section_education`
- `skill_category_skill` for each skill under its category
- `project_skill` for each skill in a project's tech list
- `experience_bullet_point` / `project_bullet_point` for each bullet under a role or project
- When adding a new version of a role or project, also list all of the existing version's bullets (and skills, for a project) under the new version, so either version can use any of them.
- The built-in "Other" category isn't listed under any section.

## Cover letters

Cover letters use the same join tables as resumes, with the `cover_letter_` prefix (`cover_letter_section`, `cover_letter_bullet_point`, etc.), so any kind of content can go in one.
- **Each paragraph is its own section.** Suggest a short title for each from its content (e.g. "intro", "McGraw intro", "key technical demands", "outro", "thank you"), reusing an existing section title when the paragraph plays the same role, so later letters build on the same pools of sentences. Show the suggested titles to the user and let them change any before writing the file. Titles are labels for the user only and are never printed in the letter.
- **Sentences** → `narrative_content`, one row per sentence. **Bullets** in a paragraph → `bullet_point`, listed directly under the section (`section_bullet_point`), unless they belong under a role or project.
- **Greeting:** everything after "Dear" (without the comma) is the `addressee`.
- **Closing:** the closing word(s) → `sign_off` (reuse the account's existing one, e.g. "Sincerely"). The name under it goes in `signature_name` only if it differs from the header's `full_name` (e.g. without a nickname); otherwise leave it empty.
- **Links:** a letter has no direct link to a resume. A sent letter gets its posting's `job_posting_id` and, unless it was sent with a different header, the posting's `header_id`. A base letter has no posting.
- Name the file after the letter, e.g. `03_neptune_cover_letter.sql`, and follow it as the example.

## Mapping a resume onto the tables

- **Account:** the first file inserts the one account row (`INSERT INTO account DEFAULT VALUES`); later files reuse it.
- **Header** → `header` with `pg_temp.header(...)`: `full_name`, the `headline` (role title under the name), `email`, `phone`, `location`, `linkedin_url`, `github_url`, `portfolio_url`. A resume with a different headline or contact detail gets its own header version; an identical one is reused. For a base resume whose contact details changed (e.g. a new phone number), ask whether that's the current header going forward. Sent resumes keep theirs as sent.
- **Sections:** use the five built-in sections ("Summary" 1, "Skills" 2, "Experience" 3, "Projects" 4, "Education" 5) where they fit. Create other sections as user sections with the resume's own heading, such as "Freelance and Consulting Experience".
- **Summary** → `narrative_content`, one row per sentence.
- **Skills** → `skill_category` and `skill`. Keep the resume's own grouping and order. Skills the resume doesn't group go in the built-in "Other" category (id 1).
- **Experience** → `experience` (`role_title`, `organization`, `location`, `dates` as displayed; any role, paid or volunteer), plus one `bullet_point` per bullet.
- **Projects** → `project` (`project_title`, `done_for` if the resume names who it was for, `url`, `dates`), plus its skills and bullets. `add_project` takes `done_for` as its last argument.
- **Education** → `education` (`degree` with field of study, `institution`, `details`, `graduation` with honors).
- **Resume:** one `resume` row with the `name` and `header_id` (plus `job_posting_id` for a sent resume). Then the join rows (`resume_section`, `resume_experience`, `resume_bullet_point`, etc.) that reproduce the original's sections and order, using `position`. Join rows are always new, even when every item they point to is reused.

## Rules

- **Copy text exactly.** Don't reword, fix or "improve" anything, even words on the banned list in `docs/WRITING_RULES.md`. For a sent resume, keep every typo, inconsistent dash, and lowercase word as sent: it's a record of what was submitted. The one exception, for every resume: text in all caps that's only styling (headings, role titles, degrees) is stored in normal case, since the front end handles styling.
- **Don't guess missing values.** If something is ambiguous, such as a date or which section an item belongs to, ask the user.
- **SQL style:**
  - Use the helpers in `db/seed_helpers.sql` (include them with `\ir ../seed_helpers.sql` before `BEGIN`). They find or add each item by its exact text, list it under its parent, and add the document's join rows. The first argument is `'resume'` or `'cover_letter'`: `pg_temp.doc_section`, `add_sentences`, `add_bullets`, `add_skill_category`, `add_job`, `add_project`, `add_education`, plus `list_skill`, `share_bullets` and `share_project` (list one version's bullets, and skills, under another), and `set_resume_skills` (set the skills an existing resume shows under one category to an exact list). Follow `db/seed_personal/01_tech_base.sql`, `02_neptune.sql`, and `03_neptune_cover_letter.sql` as examples. Fix or extend the helpers there (they're committed and hold no personal data) rather than working around them.
  - Start with a `-- Resume: <name>` comment and how to run the file.
  - Wrap everything in `BEGIN; ... COMMIT;`.
  - First, a guard that stops the file if it was already run:
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM resume WHERE name = '<name>') THEN RAISE EXCEPTION 'Resume "<name>" is already loaded.'; END IF; END $$;`
  - Never hard-code generated ids, except the built-in sections and "Other". Refer to the account as `(SELECT account_id FROM account)`. Refer to existing rows with a lookup on their matching values, e.g. `(SELECT experience_id FROM experience WHERE organization = 'Acme' AND role_title = 'Engineer' AND dates = '2020 - 2023')`, using every matching column so the lookup can only match one row. A lookup that matches more than one row fails, and the whole file rolls back, so a mistake never half-loads.
  - Use `INSERT ... RETURNING` or CTEs (`WITH`) to carry new ids into child rows. Insert a bullet or sentence only if no row has that exact text (`WHERE NOT EXISTS`), then look it up.
  - Escape single quotes (`'` → `''`).
- **Check before handing it over:** run the file against the test database (`resume_tweaker_test`, which the tests rebuild), rebuild the resume as plain text from the join tables, and compare it with the original. Then run the backend tests to reset the test database.
- **How to run it** (tell the user), from the project folder:
  `$(brew --prefix postgresql@18)/bin/psql -p 5433 -d resume_tweaker -v ON_ERROR_STOP=1 -f db/seed_personal/<file>.sql`
  After the first file, also run `db/seed_defaults.sql` once (see its header); running it again later is harmless.
- **Report back before the user runs the file:**
  - rows inserted per table
  - items reused, by table (e.g. "reused: 2 projects, 9 bullets, 14 skills")
  - new versions of existing items, and what differs
  - every choice made, and any questions still open
