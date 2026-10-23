# Front End Checks

Rules the database does not enforce, so the app must handle them. See the database schema in [DATABASE.md](DATABASE.md).

## Delete warnings
Every foreign key uses `ON DELETE CASCADE`, so deleting a row also deletes every row that refers to it. Before any delete, warn the user and list what else will be removed.

Cascades that remove more than the user might expect:
- **Section**: removed from every resume and cover letter. Also deletes every `experience`, `bullet_point`, and `narrative_content` row whose `section_id` points to it (e.g. deleting an "Experience" section deletes all jobs written for it, and their bullets).
- **Skill category**: deletes all of its skills, which then drop off every project and resume.
- **Skill**: removed from every project (`project_skill`) and resume (`resume_skill`, `resume_project_skill`).
- **Experience / project**: deletes its bullet points from the library, not just from resumes.
- **Resume / cover letter**: removes only its own selections. Library items are kept. Versions copied from it stay; their `based_on_resume_id` / `based_on_letter_id` is set to empty.
- **Job posting**: deletes every resume and cover letter made for it, along with their selections.

If deleting a section should keep its experiences and bullets, those `section_id` columns would need `ON DELETE SET NULL` instead (which requires them to allow NULL; `bullet_point.section_id` is currently `NOT NULL`).

## Versions
- **Base resumes / cover letters** (no `job_posting_id`) can be edited directly whenever the user wants. They're ongoing starting points.
- **Warn before editing a base resume / cover letter.** Editing it changes it in place, and its earlier state can't be recovered. Before the first edit in a session, tell the user this and offer to create a new base resume based on this one instead (`based_on_resume_id` / `based_on_letter_id` set to the original). Let them choose to edit in place or make a copy.
- **Never edit a tailored version to fit a different posting.** Starting from any earlier resume or cover letter, base or tailored, creates a new row with `based_on_resume_id` / `based_on_letter_id` set to the original.
- **Saving a tailored version as a new base:** the user can copy a tailored version into a new base resume (no posting) to reuse later.
- **Copy the whole tree.** A copy duplicates every join row under the original (sections, then items, then sub-items like skills and bullets), with new ids and the same `position` values. The library items themselves are not copied.

## Suggesting and adding items
- **Section contents**: the section's `title` decides which items to offer (e.g. a "skills" section offers skill categories).
- **Skills in a category**: only suggest skills whose `skill.category_id` matches the selected category. The database doesn't check this.
- **Skills in a project**: suggest skills from `project_skill` for that project, in its default `position` order. The user picks which ones appear on each resume (`resume_project_skill`).
- **Bullets**: only offer bullets whose `bullet_point.experience_id` / `project_id` matches the selected experience or project. A bullet's `resume_experience_id` or `resume_project_id` must belong to the same resume section as the bullet. Leave both empty for a bullet listed directly in the section.

## Timestamps
- `updated_at` defaults to the creation time. Set it whenever a row is edited (here or with a database trigger).
- Join tables have no timestamps. When a resume's or cover letter's selections change (items added, removed, or reordered), update that resume's or cover letter's `updated_at`.
