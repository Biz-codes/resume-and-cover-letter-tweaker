# Front End Checks

Rules the database does not enforce, so the app must handle them. See the database schema in [DATABASE.md](DATABASE.md). When a rule fails, the backend returns the error code named here (see [API_ERRORS.md](API_ERRORS.md)), and the request changes nothing.

## Delete warnings
The five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") and the built-in "Other" skill category can't be deleted or renamed. The backend refuses with `BUILT_IN_PROTECTED`, and a database trigger blocks it as a backstop.

Every foreign key uses `ON DELETE CASCADE`, so deleting a row also deletes every row that refers to it. Before any delete, warn the user and list what else will be removed.

Cascades that remove more than the user might expect:
- **Section**: built-in sections can never be deleted, so don't offer the option. Deleting a user-created section removes it from every resume and cover letter. Also deletes every library item whose `section_id` points to it: narrative content, skill categories (and their skills), experiences, projects, bullet points, and education (e.g. deleting an "Experience" section deletes all jobs written for it, and their bullets).
- **Skill category**: its skills move to the built-in "Other" category and stay in the library. Resumes and cover letters keep showing the same skills, under "Other" (see "Deleting a skill category" below). The built-in "Other" category can never be deleted or renamed, so don't offer the option.
- **Skill**: removed from every project (`project_skill`), resume (`resume_skill`, `resume_project_skill`), and cover letter (`cover_letter_skill`, `cover_letter_project_skill`).
- **Experience / project**: deletes its bullet points from the library, not just from resumes.
- **Resume / cover letter**: removes only its own selections. Library items are kept. Versions copied from it stay; their `based_on_resume_id` / `based_on_letter_id` is set to empty.
- **Resume**: also deletes every cover letter linked to it through `cover_letter.resume_id`.
- **Job posting**: deletes every resume and cover letter made for it, along with their selections.
- **Sign-off**: cover letters that used it are kept; their `sign_off_id` is set to empty, so they have no closing until the user picks another.
- **Tone set**: deletes its tone rules. Resumes and cover letters that used it are kept; their `tone_set_id` is set to empty.
- **Account**: deletes everything the account owns.

### Deleting a skill category
The database moves the library skills to "Other" on its own (`ON DELETE SET DEFAULT`), but the category's resume and cover letter selections would still be deleted by the cascade. Before deleting the category, in one transaction:
1. Find every `resume_skill_category` and `cover_letter_skill_category` row that uses it.
2. In the same resume or cover letter section, find the "Other" category row, or create one at the deleted category's `position`.
3. Move the selected skills (`resume_skill` / `cover_letter_skill` rows) under that "Other" row, after any skills already there, keeping their order. Skip skills already selected under "Other".
4. Then delete the category.

If any step fails, the transaction rolls back: the category, its skills, and every resume and cover letter stay exactly as they were. Return `INTERNAL_ERROR` with a message like "Couldn't delete the category; nothing was changed."

## Accounts
- **New accounts get the defaults:** when the backend creates an account, add the starting writing rules and the "Sincerely" sign-off (the same rows `db/seed_defaults.sql` adds).
- **Scope every query to the current account.** Until logins exist, the app always uses the single owner account.
- **No cross-account links:** a resume or cover letter may only use library items and job postings from its own account. The database doesn't check this. Return `CROSS_ACCOUNT_LINK` if attempted.

## Versions
- **Base resumes / cover letters** (no `job_posting_id`) can be edited directly whenever the user wants. They're ongoing starting points.
- **Warn before editing a base resume / cover letter.** Editing it changes it in place, and its earlier state can't be recovered. Before the first edit in a session, tell the user this and offer to create a new base resume based on this one instead (`based_on_resume_id` / `based_on_letter_id` set to the original). Let them choose to edit in place or make a copy.
- **Never edit a tailored version to fit a different posting.** Starting from any earlier resume or cover letter, base or tailored, creates a new row with `based_on_resume_id` / `based_on_letter_id` set to the original.
- **Saving a tailored version as a new base:** the user can copy a tailored version into a new base resume (no posting) to reuse later.
- **Cover letter links:** a cover letter's `job_posting_id` must match its resume's `job_posting_id` when both are set (otherwise `VALIDATION_FAILED`). When a cover letter is built for a new tailored resume, link it to that new resume, not the one it was copied from.
- **Copy the whole tree.** A copy duplicates every join row under the original (sections, then items, then sub-items like skills and bullets), with new ids and the same `position` values. The library items themselves are not copied.

## Suggesting and adding items
- **No content restrictions:** any kind of library item can go in any section, including mixes in one section, and any section can go in any resume or cover letter.
- **Default home sections:** new skill categories, experiences, projects, and education entries default to the built-in "Skills", "Experience", "Projects", and "Education" sections. The user can choose any other section.
- **Mixed sections:** items placed directly in the same resume or cover letter section share one `position` numbering across all join tables. Assign and reorder positions across item types together, so a sentence, an experience, and a bullet in one section have a single order.
- **Section contents**: when suggesting content for a section, start with library items whose `section_id` (home section) matches, but let the user add any library item to any section. Never decide from the section's `title`.
- **Duplicates:** a section title already used in the account, or the same item picked twice under one parent, returns `DUPLICATE`.
- **Section titles in output**: print section titles in a resume. Never print them in a cover letter, where they're descriptors for the user only.
- **Skills in a category**: only suggest skills whose `skill.category_id` matches the selected category. The database doesn't check this; the backend returns `VALIDATION_FAILED` if a mismatched skill is sent.
- **Skills in a project**: suggest skills from `project_skill` for that project, in its default `position` order. The user picks which ones appear on each resume or cover letter (`resume_project_skill`, `cover_letter_project_skill`).
- **Bullets**: only offer bullets whose `bullet_point.experience_id` / `project_id` matches the selected experience or project. A bullet's `resume_experience_id` / `resume_project_id` (or the cover letter equivalents) must belong to the same section as the bullet. Leave both empty for a bullet listed directly in the section. A bullet that breaks these rules returns `VALIDATION_FAILED`.
- **Default sign-off:** new cover letters use the account's "Sincerely" sign-off. The user can pick another or add their own.
- **Default greeting:** when creating a cover letter, set `addressee` to "[company] Hiring Team" from the job posting (or "Hiring Team" with no posting). Keep any value the user types in instead.

## Rewordings
- **Never overwrite library content with a rewording.** When the user accepts a reworded or new bullet point or sentence, insert a new `bullet_point` or `narrative_content` row with the same `section_id` (and the same `experience_id` / `project_id` for bullets).
- **Swap it into the current document only.** Point the current resume's or cover letter's join row at the new row. Other resumes and cover letters keep using the original.

## Writing rules
- **Apply every active `writing_rule`** to every suggestion. Check `term` rules by exact text match in code, then ask Claude whether each match is filler or a real term. Ask Claude to check `pattern` rules.
- **Apply the resume's or cover letter's tone set**, if it has one, to every suggestion for it.
- **Copying a version keeps its `tone_set_id`** unless the user picks another.

## Failures outside the database
- **Job posting fetch:** if the page can't be fetched or no job description is found, return `POSTING_FETCH_FAILED` and show the paste-in box.
- **Claude API:** if a request still fails after the SDK's retries, or Claude declines it, return `AI_UNAVAILABLE`. Keep the user's work and offer Retry.

## Timestamps
- `updated_at` defaults to the creation time, and a database trigger updates it whenever a row is edited.
- Join tables have no timestamps. When a resume's or cover letter's selections change (items added, removed, or reordered), update that resume's or cover letter's `updated_at`.
