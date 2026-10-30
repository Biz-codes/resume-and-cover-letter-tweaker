# Front End Checks

Rules the database does not enforce, so the app must handle them. See the database schema in [DATABASE.md](DATABASE.md). When a rule fails, the backend returns the error code named here (see [API_ERRORS.md](API_ERRORS.md)), and the request changes nothing.

## Delete warnings
The five built-in sections ("Summary", "Skills", "Experience", "Projects", "Education") and the built-in "Other" skill category can't be deleted or renamed. The backend refuses with `BUILT_IN_PROTECTED`, and a database trigger blocks it as a backstop.

Most foreign keys use `ON DELETE CASCADE`, so deleting a row also deletes every row that refers to it. The exceptions (`header_id`, `sign_off_id`, `tone_set_id`, and `based_on_resume_id` / `based_on_letter_id`) are set to empty instead, as described below. Before any delete, warn the user and list what else will be removed or changed, including any sent versions it affects.

Cascades that remove more than the user might expect:
- **Section**: built-in sections can never be deleted, so don't offer the option. Deleting a user-created section removes it, and everything placed in it, from every resume and cover letter. The library items it listed are kept; they're just no longer listed under that section.
- **Skill category**: its skills stay in the library. Any skill no other category lists is listed under the built-in "Other" category. Resumes and cover letters keep showing the same skills, under "Other" (see "Deleting a skill category" below). The built-in "Other" category can never be deleted or renamed, so don't offer the option.
- **Skill**: removed from every category (`skill_category_skill`), project (`project_skill`), resume (`resume_skill`, `resume_project_skill`), and cover letter (`cover_letter_skill`, `cover_letter_project_skill`).
- **Experience / project**: removes it, and the bullets (and a project's skills) under it, from every resume and cover letter. The bullets and skills stay in the library and under any other role or project that lists them.
- **Bullet point / narrative content**: removed from every list (`experience_bullet_point`, `section_narrative_content`, etc.) and from every resume and cover letter that uses it.
- **Resume / cover letter**: removes only its own selections. Library items are kept. Versions copied from it stay; their `based_on_resume_id` / `based_on_letter_id` is set to empty.
- **Header**: job postings, resumes, and cover letters that use it are kept; their `header_id` is set to empty, so they show no header until the user picks another. List them in the warning.
- **Job posting**: deletes every resume and cover letter made for it, along with their selections. Its interviews that no other posting is linked to are deleted too (the app does this in the same transaction); interviews shared with another posting stay. List both in the warning.
- **Interview**: removed from every posting it was linked to.
- **Sign-off**: cover letters that used it are kept; their `sign_off_id` is set to empty, so they have no closing until the user picks another.
- **Tone** (`tone_set`): deletes its tone rules. Resumes and cover letters that used it are kept; their `tone_set_id` is set to empty.
- **Account**: deletes everything the account owns.

### Deleting a skill category
Deleting the category would remove its skill list and its resume and cover letter selections. Before deleting it, in one transaction:
1. List every skill in the category that no other category lists under "Other" (`skill_category_skill`), after the skills already there, keeping their order.
2. Find every `resume_skill_category` and `cover_letter_skill_category` row that uses it.
3. In the same resume or cover letter section, find the "Other" category row, or create one at the deleted category's `position`.
4. Move the selected skills (`resume_skill` / `cover_letter_skill` rows) under that "Other" row, after any skills already there, keeping their order. Skip skills already selected under "Other".
5. Then delete the category.

If any step fails, the transaction rolls back: the category, its skills, and every resume and cover letter stay exactly as they were. Return `INTERNAL_ERROR`, whose message says nothing was changed ("Something went wrong. Nothing was changed.").

## Accounts
- **New accounts get the defaults:** when the backend creates an account, add the starting writing rules and the "Sincerely" sign-off (the same rows `db/seed_defaults.sql` adds).
- **Scope every query to the current account.** Until logins exist, the app always uses the single owner account.
- **No cross-account links:** a resume or cover letter may only use library items and job postings from its own account. The database doesn't check this. Return `CROSS_ACCOUNT_LINK` if attempted.

## Versions
- **Base resumes / cover letters** (no `job_posting_id`) can be edited directly whenever the user wants. They're ongoing starting points.
- **Warn before editing a base resume / cover letter.** Editing it changes it in place, and its earlier state can't be recovered. Until the user chooses, once per base version while the app is open, show it read-only with this warning, and offer to create a new base resume based on this one instead (`based_on_resume_id` / `based_on_letter_id` set to the original). Let them choose to edit in place or make a copy. "Done editing" shows it read-only again, with the warning, and the next edit asks again. Versions for a posting are edited without the warning until they're sent.
- **Never edit a tailored version to fit a different posting.** Starting from any earlier resume or cover letter, base or tailored, creates a new row with `based_on_resume_id` / `based_on_letter_id` set to the original.
- **Saving a tailored version as a new base:** the user can copy a tailored version into a new base resume (no posting) to reuse later.
- **Resumes and cover letters connect only through their job posting:** there's no direct link between them. A resume or cover letter made for a posting gets that posting's `job_posting_id`, not the one of the version it was copied from.
- **Copy the whole tree.** A copy duplicates every join row under the original (sections, then items, then sub-items like skills and bullets), with new ids and the same `position` values. The library items themselves are not copied.

## Sent versions are locked
Recording the date a posting was applied to (`job_posting.applied_on`) marks its resumes and cover letters as sent. From then on they're a record of what went out, so:
- **No edits:** their fields, sections, and selections can't be changed. Show them read-only and offer "Make a copy" instead: a new base version, or a version for another posting. The backend returns `VERSION_LOCKED` if a change is sent anyway.
- **Library edits don't reach them:** a resume or cover letter stores only which library items it picked (their ids, in its join tables), and prints each item's text and fields (a project's title, `done_for`, and dates, for example) from the library row. So editing a library item that a locked version uses (a section title, sentence, bullet, skill, skill category, role, project, education entry, sign-off, or header) saves the change as a new row instead of changing the original. The new row is listed under the same parents and lists the same children as the original. Resumes and cover letters that aren't locked switch to the new row; locked ones keep the original. Headers, roles, and projects are the exceptions: see "Headers" and "Changing a role or project" below.
- **Deleting is still allowed**, after a warning: deleting a locked version, or a library item a locked version uses, changes the record of what was sent. Say so in the delete warning.
- **Unlocking:** clearing `applied_on` unlocks the posting's versions. Warn the user first.
- **Renaming** a locked version (`name`) is allowed, since the name is only a label. Changing any of its other fields (header, tone, a letter's greeting, sign-off, or signature name) returns `VERSION_LOCKED`.

## Changing a role or project
A role's or project's fields (a role's `role_title`, `organization`, `location`, and `dates`; a project's title, `done_for`, link, and dates) are printed from its row, and a user may want different versions in different resumes in progress (with dates or without, for example). So editing one:
- **Sent versions never change.** If a locked version uses it, the change is saved as a new row (see "Sent versions are locked").
- **Ask about resumes and cover letters in progress.** If unlocked ones use it, ask whether to apply the change to them, naming them. The default is no.
  - **Yes:** they get the change. It's made in place, unless a locked version uses the row; then it's a new row and they switch to it.
  - **No:** the change is saved as a new row, and they keep the original until the user picks the new one.
- **Nothing uses it:** edit it in place.
- **A new row** is listed right after the original in every section that lists it, and lists the same bullets (and a project's skills).

## Headers
- **A posting's header:** right after a job posting is created, the user picks its header (`job_posting.header_id`). Suggest the most recently used header, with the headline based on the posting's job title (a new header if that changes it).
- **New resumes and cover letters for a posting** start with the posting's header. Ask the user to use it, edit it, or pick another saved header. A posting with no header yet asks for one first.
- **New base resumes and cover letters** start with the header of the version they're copied from, or the most recently used header when starting fresh.
- **Changing the headline or contact details:** if no locked (sent) resume, cover letter, or applied posting uses the header, edit it in place. If one does, save the change as a new header (see "Sent versions are locked"), so sent versions keep the header they went out with. Nothing else switches to the new header automatically, since applications in progress at the same time may need different headers: an edit made from a resume or cover letter points only that one at the new header, and an edit made on the header library page just adds the header for the user to pick. Whenever a header would be added (the New header button, or an edit saved as a new header), reuse an existing header with the exact same values instead of adding a duplicate.
- **Picking header values on a resume or cover letter:** each value is picked on its own (from the values saved in any header, or typed in new). Saving never changes a saved header: the document points at the header with exactly those values, or a new one is added. A sent version returns `VERSION_LOCKED`.

## Suggesting and adding items
- **Defaults** (`backend/app/defaults.py`, until AI suggestions replace it in phase 5): each level of a resume's or cover letter's tree starts with what the most recently updated other document of the same kind showed for the same parent, in its order. A new document gets the sections of the latest one that has any; an added section gets the items of the latest one that put anything in it; an added role, project, or category gets the bullets and skills it showed in the latest one that showed any. When no other document has, the default is the first 3 the library lists under the parent (for a section, of the kind it lists most), and no sections for a new document. Skills and bullets the parent no longer lists are left out, and so are bullets already in the section. A placed item's skills or bullets sent explicitly (even an empty list) are used instead, which a later "Build from scratch" choice will use to start empty. Everything else the library lists there is offered under "More options".
- **No content restrictions:** any kind of library item can go in any section, including mixes in one section, and any section can go in any resume or cover letter.
- **New items are listed under their parent:** a new item is added to the list of the section, category, role, or project it's created in (e.g. a new bullet written under a role goes in that role's `experience_bullet_point` list). A new skill written under a project on a resume or cover letter is listed under the project and the built-in "Other" category, since every skill has a category. A new skill's name must be new (`DUPLICATE`). New skill categories, experience, projects, and education entries default to the built-in "Skills", "Experience", "Projects", and "Education" sections, and new skills to the built-in "Other" category. The user can choose any other section or category (or, for a skill category, no section). Narrative content can be written on the Narrative content page too, where the user checks any number of sections to list it under (or none); the edit form changes that choice the same way. When a text edit of a locked excerpt saves a new excerpt, the sections chosen apply to the new one and the original keeps its own.
- **Versions of a role or project:** besides editing (see "Changing a role or project"), "New version" adds another row on purpose (e.g. a new title, or dates written differently), listed right after the original in every section that lists it and listing the same bullets (and a project's skills). Nothing switches to it; each resume and cover letter keeps the version it uses until the user picks another.
- **New versions of text in a resume or cover letter:** "New version" on a bullet or narrative content saves the changed text as a new row, listed right after the original wherever the original is listed (and under the role, project, or section it's written in), and puts it in the original's place in this document only. The original is never changed. Text the same as the original (ignoring spaces at the ends) saves nothing: the front end doesn't send it, and the API returns `VALIDATION_FAILED`. Only a bullet shown under that role or project, or an item placed directly in that section, can be replaced (`NOT_FOUND`).
- **Unlisted items:** an item no parent lists (e.g. after its role was deleted) stays in the library. Show it in the library so the user can list it again or delete it.
- **Skills always have a category:** taking a skill out of the only category that lists it lists it under "Other" instead. Taking a skill out of "Other" when no other category lists it returns `VALIDATION_FAILED`; add it to another category first.
- **"Other" isn't listed under sections:** listing it under a section returns `VALIDATION_FAILED`.
- **Mixed sections:** items placed directly in the same resume or cover letter section share one `position` numbering across all join tables. Assign and reorder positions across item types together, so a sentence, an experience, and a bullet in one section have a single order.
- **Section contents**: when suggesting content for a section, start with the items the section lists (`section_narrative_content`, `section_skill_category`, `section_experience`, `section_project`, `section_bullet_point`, `section_education`), but let the user add any library item to any section. When adding content by hand, the type of content starts as the kind the section lists most (none when it lists nothing). Never decide from the section's `title`.
- **Duplicates:** a section title, skill category name, or skill name already used in the account (ignoring capitals, and counting the built-in sections and "Other"), or the same item picked twice under one parent, returns `DUPLICATE`. The message names the existing item so the user can use it instead.
- **Section titles in output**: print section titles in a resume. Never print them in a cover letter, where they're descriptors for the user only. The Sections page groups sections the same way: resume headings (built-in or used by a resume), cover letter labels (used only by cover letters), and ones not used yet.
- **Skills in a category**: only suggest skills the category lists in `skill_category_skill`, in its default `position` order. The database doesn't check this; the backend returns `VALIDATION_FAILED` if an unlisted skill is sent.
- **Skills in a project**: suggest skills from `project_skill` for that project, in its default `position` order. The user picks which ones appear on each resume or cover letter (`resume_project_skill`, `cover_letter_project_skill`).
- **Bullets**: only offer bullets the selected experience or project lists (`experience_bullet_point` / `project_bullet_point`). Suggest a subset that fits the posting, leaving out bullets too similar to ones already chosen. A bullet's `resume_experience_id` / `resume_project_id` (or the cover letter equivalents) must belong to the same section as the bullet. Leave both empty for a bullet listed directly in the section. A bullet that breaks these rules returns `VALIDATION_FAILED`. A bullet can be placed once per section (directly, or under one role or project); placing it again returns `DUPLICATE`.
- **Default sign-off:** new cover letters use the account's "Sincerely" sign-off. The user can pick another or add their own.
- **Default greeting:** when creating a cover letter, set `addressee` to "[organization] Hiring Team" from the job posting (or "Hiring Team" with no posting). Keep any value the user types in instead.

## Rewordings
- **Never overwrite library content with a rewording.** When the user accepts a reworded or new bullet point or narrative content, insert a new `bullet_point` or `narrative_content` row and list it under every parent that lists the original (sections, roles, projects), right after the original.
- **Swap it into the current document only.** Point the current resume's or cover letter's join row at the new row. Other resumes and cover letters keep using the original.

## Writing rules
- **Apply every active `writing_rule`** to every suggestion. Check `term` rules by exact text match in code, then ask Claude whether each match is filler or a real term. Ask Claude to check `pattern` rules.
- **Apply the resume's or cover letter's tone**, if it has one, to every suggestion for it.
- **Copying a version keeps its `tone_set_id`** unless the user picks another.
- **Edited in place:** writing rules, tones, and tone rules steer suggestions and are never printed, so editing them never saves a new row, even when a sent version uses the tone.
- **Reordering a tone's rules** sends every rule in the tone, once each, in the new order. A list that leaves one out, repeats one, or includes another set's rule returns `VALIDATION_FAILED`.

## Failures outside the database
- **Job posting fetch:** if the page can't be fetched or no job description is found, return `POSTING_FETCH_FAILED` and show the paste-in box.
- **Claude API:** if a request still fails after the SDK's retries, or Claude declines it, return `AI_UNAVAILABLE`. Keep the user's work and offer Retry.

## Timestamps
- `updated_at` defaults to the creation time, and a database trigger updates it whenever a row is edited.
- Join tables have no timestamps. When a resume's or cover letter's selections change (items added, removed, or reordered), update that resume's or cover letter's `updated_at`.
