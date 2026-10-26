# Front End Checks

Rules the database does not enforce, so the app must handle them. See the database schema in [DATABASE.md](DATABASE.md).

## Delete warnings
The five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") can't be deleted or renamed. The backend refuses, and a database trigger blocks it as a backstop.

Every foreign key uses `ON DELETE CASCADE`, so deleting a row also deletes every row that refers to it. Before any delete, warn the user and list what else will be removed.

Cascades that remove more than the user might expect:
- **Section**: built-in sections can never be deleted, so don't offer the option. Deleting a user-created section removes it from every resume and cover letter. Also deletes every library item whose `section_id` points to it: narrative content, skill categories (and their skills), experiences, projects, bullet points, and education (e.g. deleting an "Experience" section deletes all jobs written for it, and their bullets).
- **Skill category**: deletes all of its skills, which then drop off every project and resume.
- **Skill**: removed from every project (`project_skill`) and resume (`resume_skill`, `resume_project_skill`).
- **Experience / project**: deletes its bullet points from the library, not just from resumes.
- **Resume / cover letter**: removes only its own selections. Library items are kept. Versions copied from it stay; their `based_on_resume_id` / `based_on_letter_id` is set to empty.
- **Resume**: also deletes every cover letter linked to it through `cover_letter.resume_id`.
- **Job posting**: deletes every resume and cover letter made for it, along with their selections.
- **Tone set**: deletes its tone rules. Resumes and cover letters that used it are kept; their `tone_set_id` is set to empty.
- **Account**: deletes everything the account owns.

## Accounts
- **Scope every query to the current account.** Until logins exist, the app always uses the single owner account.
- **No cross-account links:** a resume or cover letter may only use library items and job postings from its own account. The database doesn't check this.

## Versions
- **Base resumes / cover letters** (no `job_posting_id`) can be edited directly whenever the user wants. They're ongoing starting points.
- **Warn before editing a base resume / cover letter.** Editing it changes it in place, and its earlier state can't be recovered. Before the first edit in a session, tell the user this and offer to create a new base resume based on this one instead (`based_on_resume_id` / `based_on_letter_id` set to the original). Let them choose to edit in place or make a copy.
- **Never edit a tailored version to fit a different posting.** Starting from any earlier resume or cover letter, base or tailored, creates a new row with `based_on_resume_id` / `based_on_letter_id` set to the original.
- **Saving a tailored version as a new base:** the user can copy a tailored version into a new base resume (no posting) to reuse later.
- **Cover letter links:** a cover letter's `job_posting_id` must match its resume's `job_posting_id` when both are set. When a cover letter is built for a new tailored resume, link it to that new resume, not the one it was copied from.
- **Copy the whole tree.** A copy duplicates every join row under the original (sections, then items, then sub-items like skills and bullets), with new ids and the same `position` values. The library items themselves are not copied.

## Suggesting and adding items
- **No content restrictions:** any kind of library item can go in any section, including mixes in one section, and any section can go in any resume.
- **Default home sections:** new skill categories, experiences, projects, and education entries default to the built-in "Skills", "Experience", "Projects", and "Education" sections. The user can choose any other section.
- **Mixed sections:** items placed directly in the same resume or cover letter section share one `position` numbering across all join tables. Assign and reorder positions across item types together, so a sentence, an experience, and a bullet in one section have a single order.
- **Section contents**: when suggesting content for a section, start with library items whose `section_id` (home section) matches, but let the user add any library item to any section. Never decide from the section's `title`.
- **Section titles in output**: print section titles in a resume. Never print them in a cover letter, where they're descriptors for the user only.
- **Skills in a category**: only suggest skills whose `skill.category_id` matches the selected category. The database doesn't check this.
- **Skills in a project**: suggest skills from `project_skill` for that project, in its default `position` order. The user picks which ones appear on each resume (`resume_project_skill`).
- **Bullets**: only offer bullets whose `bullet_point.experience_id` / `project_id` matches the selected experience or project. A bullet's `resume_experience_id` or `resume_project_id` must belong to the same resume section as the bullet. Leave both empty for a bullet listed directly in the section.
- **Default greeting:** when creating a cover letter, set `addressee` to "[company] Hiring Team" from the job posting (or "Hiring Team" with no posting). Keep any value the user types in instead.

## Rewordings
- **Never overwrite library content with a rewording.** When the user accepts a reworded or new bullet point or sentence, insert a new `bullet_point` or `narrative_content` row with the same `section_id` (and the same `experience_id` / `project_id` for bullets).
- **Swap it into the current document only.** Point the current resume's or cover letter's join row at the new row. Other resumes and cover letters keep using the original.

## Writing rules
- **Apply every active `writing_rule`** to every suggestion. Check `term` rules by exact text match in code, then ask Claude whether each match is filler or a real term. Ask Claude to check `pattern` rules.
- **Apply the resume's or cover letter's tone set**, if it has one, to every suggestion for it.
- **Copying a version keeps its `tone_set_id`** unless the user picks another.

## Timestamps
- `updated_at` defaults to the creation time. Set it whenever a row is edited (here or with a database trigger).
- Join tables have no timestamps. When a resume's or cover letter's selections change (items added, removed, or reordered), update that resume's or cover letter's `updated_at`.
