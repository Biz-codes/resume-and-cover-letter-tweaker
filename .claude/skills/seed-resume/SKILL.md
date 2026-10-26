---
name: seed-resume
description: Translate one of the user's existing resumes (a PDF path or pasted text) into SQL INSERT statements for db/seed_personal.sql, following the schema in docs/DATABASE.md. Use when the user wants to load an existing resume into the database.
---

# Turn an existing resume into seed SQL

The output goes in `db/seed_personal.sql`. That file is listed in `.gitignore` because it holds personal data. Never copy its contents into a committed file, a commit message, or a doc.

## Before starting

1. **Read the schema.** Read `docs/DATABASE.md`. Table and column names change over time, so never work from memory.
2. **Check the schema exists.** If there are migrations, the seed must match them. If the schema and `DATABASE.md` disagree, stop and tell the user.
3. **Read what's already seeded.** If `db/seed_personal.sql` exists, read it. A second resume reuses existing rows instead of duplicating them, for example the same job with different bullets.

## Mapping a resume onto the tables

- **Header** → `account`: `full_name`, `email`, `phone`, `location`, `linkedin_url`, `github_url`, `portfolio_url`. There's only one account row; update it rather than adding another.
- **Sections:** use the five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") where they fit. Create other sections as user sections with the resume's own heading, such as "Freelance and Consulting Experience".
- **Every library item needs a `section_id`** (its home section).
- **Summary** → `narrative_content`, one row per sentence.
- **Skills** → `skill_category` and `skill`. Keep the resume's own grouping and order. Skills the resume doesn't group go in the built-in "Other" category (id 1).
- **Experience** → `experience` (`job_title`, `company`, `location`, `dates` as displayed), plus one `bullet_point` per bullet with `experience_id` set.
- **Projects** → `project` (`project_title`, `url`, `dates`), plus `project_skill` for each skill listed, plus bullets with `project_id` set.
- **Education** → `education` (`degree` with field of study, `institution`, `details`, `graduation` with honors).
- **Base resume:** add one `resume` row with no `job_posting_id` and a `name` the user picks (ask). Then add the join rows (`resume_section`, `resume_experience`, `resume_bullet_point`, etc.) that reproduce the original resume's sections and order, using `position`.

## Rules

- **Copy text exactly.** Don't reword, fix or "improve" anything, even words on the banned list in `docs/WRITING_RULES.md`. Seeded content is never rewritten on import.
- **Don't guess missing values.** If something is ambiguous, such as a date or which section an item belongs to, ask the user.
- **SQL style:**
  - Wrap the inserts in `BEGIN; ... COMMIT;`.
  - Use `INSERT ... RETURNING` or CTEs (`WITH`) to carry generated ids into child rows instead of hard-coding them. The built-in sections have fixed ids and can be referenced directly.
  - Escape single quotes (`'` → `''`).
  - Add a comment header for each resume (`-- Resume: <name>`).
- **Report back** how many rows each table gets, plus any choices you made, before the user runs the file.
