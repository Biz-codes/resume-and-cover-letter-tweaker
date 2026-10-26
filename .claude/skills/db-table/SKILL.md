---
name: db-table
description: Add or change a table or column in the database design. Use whenever the schema in docs/DATABASE.md changes (new table, new or changed column, constraint, or delete behavior), so the change follows the project's table format and is reflected in every doc that depends on it.
---

# Add or change a database table

The schema lives in `docs/DATABASE.md`. It's the source of truth, so every schema change starts there.

## Steps

1. **Read first.** Read `docs/DATABASE.md` and `CLAUDE.md`. The user edits these files by hand. Build on the current names and never revert a rename they made.

2. **Write the table** in the existing format:
   - Heading `### table_name`, then a table with the columns `Column | Type | Constraints | Description`, with the pipes aligned.
   - Library tables go under `## Tables`. Join tables for a resume or cover letter go under `## Join Tables`.
   - Descriptions follow the set patterns:
     - primary key: `unique X id`
     - foreign key: `id of related X`
     - `created_at`: `date/time X added to db`
     - `updated_at`: `date/time X last updated`

3. **Apply the conventions:**
   - **Primary key:** `SERIAL PRIMARY KEY` named `<table>_id` (except `section.id`).
   - **Ownership:** every top-level table has `account_id INTEGER NOT NULL REFERENCES account(account_id) ON DELETE CASCADE`. Join tables don't; they belong to an account through their resume or cover letter.
   - **Timestamps:** library tables get `created_at` and `updated_at` (`TIMESTAMP`, `DEFAULT NOW()`). Join tables get none.
   - **Join tables** under a resume or cover letter get their own `SERIAL` id, a `position INTEGER NOT NULL`, and a `Unique:` line under the table.
   - **Foreign keys** use `ON DELETE CASCADE` unless the user decides otherwise. Current exceptions use `ON DELETE SET NULL`: `based_on_resume_id`, `based_on_letter_id`, `tone_set_id`, and `sign_off_id`. `skill.category_id` uses `ON DELETE SET DEFAULT` (moves skills to the built-in "Other" category). If a cascade would delete a resume or cover letter because something it merely uses was deleted, ask the user whether it should be an exception.
   - **Enums** are Postgres enum types. Name the type in the Type column and list its values in a note.

4. **Explain the change** with a `Note:` line under the table when the design isn't obvious from the columns.

5. **Update the dependent docs** in the same change:
   - **App-side rules** (anything the database doesn't enforce): add them as a note under the table in `docs/DATABASE.md` **and** to `docs/FRONTEND_CHECKS.md`. Both places, on purpose. In FRONTEND_CHECKS.md, name the error code the rule returns (from `docs/API_ERRORS.md`); add a new code there only if none fits.
   - **Delete behavior:** if deleting a row now removes more than the user might expect, add it to "Delete warnings" in `docs/FRONTEND_CHECKS.md`.
   - **Overview:** update the cascade paragraph if the delete exceptions changed.
   - **`CLAUDE.md`:** update "Conventions" if a convention changed.
   - **`docs/APP_FLOW.md`:** update it if the change affects the user flow.
   - **`docs/OPEN_QUESTIONS.md`:** mark a related question decided, with a link.

6. **Report back:** list each table and column changed, each doc updated, and any decision you made that the user didn't explicitly ask for.
