# Database

## Overview
Holds the user's library of resume and cover letter content (headers, sections, skills, roles, projects, bullets, narrative content, education), their job postings, and every resume and cover letter built from them.

Every resume and cover letter is saved as its own version. There are two kinds:
- **Base resumes / cover letters** have no job posting. They're ongoing starting points the user returns to and keeps updating over time.
- **Tailored versions** are linked to the job posting they were made for.

A new version can start as a copy of any earlier one, base or tailored.

The database will be seeded with the user's existing resume data as a starting point: current resumes as base resumes (no job posting), and resumes already sent for a posting as tailored versions linked to that posting. Every seeded library item is listed under at least one parent (see Library Join Tables).

Seeding happens in this order:
1. **Migrations** create the schema, the five built-in sections, and the built-in "Other" skill category.
2. **Personal data** (`db/seed_personal/`, one file per resume, not committed): the user's account, library items, job postings, and resumes, translated into SQL from their existing resumes (PDF or pasted text). It contains personal information, so it's listed in `.gitignore`. Each file is run once. Content already in the library (the same project, role, bullet, sentence, or skill) is reused rather than inserted again, so the library holds each item once and every resume points to the items it shows. A resume that was already sent is recorded exactly as sent, mistakes included, apart from all-caps styling, which is stored in normal case. The `/seed-resume` skill has the matching rules, and `db/seed_helpers.sql` has the shared SQL helpers the files use.
3. **Account defaults** (`db/seed_defaults.sql`, committed): the starting writing rules from [WRITING_RULES.md](WRITING_RULES.md) and the "Sincerely" sign-off, added for every account that doesn't have them yet. The rules go only to accounts with no writing rules at all, and the sign-off only to accounts with no sign-offs, so running it again never brings back something the user deleted or reworded.

**Demo data** (`db/seed_demo.sql`, committed) is separate: a made-up person's account, library, base resume and cover letter, and three job postings at different stages (one applied to, so its versions are locked), with the account defaults. It loads only into a database with no account yet, its own `resume_tweaker_demo` (built by `scripts/demo_db.sh`), so screenshots and recordings never show the user's real applications. It uses the same helpers, and phase 6 reuses it for demo accounts.

When the app creates a new account, the backend adds the same account defaults.

Everything belongs to an `account`. Only one account exists for now (the app runs locally for its owner), but the schema is ready for multiple accounts later. The name, headline, contact details, and links at the top of a resume or cover letter live in a `header` row, which resumes and cover letters point to.

The database has three layers:
- **Tables** are a reusable library of content (sections, skills, experience, bullet points, etc.). Each item is written once and stands alone.
- **Library Join Tables** let each parent list every child that can go under it, with a default order: a section lists its possible narrative content, skill categories, roles, projects, bullets, and education; a skill category lists its skills; a role lists its bullets; a project lists its skills and bullets. One item can be listed under many parents, so two versions of a role can share the same bullets.
- **Join Tables** record what a specific resume or cover letter uses: which library items the user selected, how they nest, and in what order.

All `updated_at` columns default to the time the row is created, and a database trigger on each table sets them whenever a row is edited.

Every foreign key uses `ON DELETE CASCADE`: deleting a row also deletes every row that refers to it, all the way down (e.g. deleting a skill removes it from every project and resume that uses it). The exceptions use `ON DELETE SET NULL`: `based_on_resume_id` / `based_on_letter_id`, so deleting an older version doesn't delete the versions copied from it, `tone_set_id` on `resume` / `cover_letter`, so deleting a tone set only clears it from the resumes and cover letters that used it, and `header_id` on `job_posting` / `resume` / `cover_letter` and `sign_off_id` on `cover_letter`, for the same reason. Because library items stand alone, deleting a parent (a section, skill category, role, or project) deletes only its list of children, not the children themselves: they stay in the library and in every other list and resume that uses them. The front end warns the user before a delete and explains what else will be removed.

Checks the app must handle (delete warnings, which items to suggest, timestamp updates) are listed in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Every library table except `writing_rule` and `tone_rule` has a `hidden` column, so an item can be set aside without losing it. A hidden item isn't offered anywhere new (pickers, More options, Add content, and the defaults a new resume, cover letter, or section starts with), but every resume and cover letter that already shows it keeps it, sent or not, and the parents that list it keep listing it. The built-in sections and "Other" can't be hidden (`BUILT_IN_PROTECTED`). An item a sent (locked) resume or cover letter uses can't be deleted (`VERSION_LOCKED`), only hidden, so a sent application always keeps its record. The app enforces these; see "Hiding" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Library join tables and resume and cover letter join tables have no timestamps. When a resume's or cover letter's selections change, the app updates that resume's or cover letter's `updated_at` instead.

## Tables
Library items stand alone: none of them stores a parent id. Which items belong under a section, skill category, role, or project is recorded in the Library Join Tables. Those lists are where the app looks when suggesting content, but they don't limit where an item can go. The resume and cover letter join tables decide which items actually appear in a given resume or cover letter, and in which section; any item can go in any section.

### account
| Column     | Type      | Constraints   | Description                    |
|------------|-----------|---------------|--------------------------------|
| account_id | SERIAL    | PRIMARY KEY   | unique account id              |
| created_at | TIMESTAMP | DEFAULT NOW() | date/time account added to db  |
| updated_at | TIMESTAMP | DEFAULT NOW() | date/time account last updated |

Note: one row for now (the app's owner). Login fields such as a password will be added when multiple accounts are needed. Every top-level table has an `account_id`; join tables belong to an account through their resume or cover letter.

### header
| Column        | Type         | Constraints                                               | Description                                   |
|---------------|--------------|-----------------------------------------------------------|-----------------------------------------------|
| header_id     | SERIAL       | PRIMARY KEY                                               | unique header id                              |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                          |
| full_name     | VARCHAR(100) | NOT NULL                                                  | name at the top                               |
| headline      | VARCHAR(100) |                                                           | role title shown under the name               |
| email         | VARCHAR(255) |                                                           | contact email                                 |
| phone         | VARCHAR(50)  |                                                           | contact phone number                          |
| location      | VARCHAR(100) |                                                           | city/state                                    |
| linkedin_url  | TEXT         |                                                           | LinkedIn link                                 |
| github_url    | TEXT         |                                                           | GitHub link                                   |
| portfolio_url | TEXT         |                                                           | portfolio link                                |
| hidden        | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the header is hidden from new choices |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time header added to db                  |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time header last updated                 |

Note: the top of a resume or cover letter: name, then the headline, then contact details and links. A posting's resume and cover letter each point to a header through `header_id`, always the posting's header.

Note: headers are library items with versions, like roles, and identical headers are reused. Editing one follows the same rules as every library item: sent resumes and cover letters, and applied postings, keep the header they went out with, and the postings and base resumes and cover letters in progress switch to the edited header only if the user picks them (a posting's resumes and cover letters always share its header). Unless every one in progress is picked and nothing sent uses it, the edit is saved as a new header, or an identical one is reused (see "Changing an item" and "Headers" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### job_posting
| Column         | Type         | Constraints                                               | Description                                     |
|----------------|--------------|-----------------------------------------------------------|-------------------------------------------------|
| job_posting_id | SERIAL       | PRIMARY KEY                                               | unique job posting id                           |
| account_id     | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                            |
| url            | TEXT         | NOT NULL                                                  | link to the posting, or its primary contact     |
| organization   | VARCHAR(100) | NOT NULL                                                  | name of hiring company or organization          |
| role_title     | VARCHAR(100) | NOT NULL                                                  | title of the position                           |
| description    | TEXT         | NOT NULL                                                  | job description text extracted from the posting |
| header_id      | INTEGER      | REFERENCES header(header_id) ON DELETE SET NULL           | id of related header                            |
| applied_on     | DATE         |                                                           | date application was sent                       |
| rejected_on    | DATE         |                                                           | date the application was turned down            |
| hired_on       | DATE         |                                                           | date the user was hired                         |
| contacts       | TEXT         |                                                           | people for this posting and how to reach them   |
| created_at     | TIMESTAMP    | DEFAULT NOW()                                             | date/time job posting added to db               |
| updated_at     | TIMESTAMP    | DEFAULT NOW()                                             | date/time job posting last updated              |

Note: `url` holds a link to the posting, or, for a job with no posting online (a referral, or a description sent by email), how to reach its primary contact. It's free text: the app shows it as a link only when it's a web address, and "Read posting" fetches a posting only from one (anything else needs the description pasted in, or reading returns `VALIDATION_FAILED`).

Note: `description` holds the extracted text after the user has checked and corrected it, so the posting can be reviewed again after the page goes offline.

Note: `applied_on`, `rejected_on`, and `hired_on` track what happened with the application, along with its interviews (`job_posting_interview`). They can be recorded or changed at any time, including after the posting's versions are locked.

Note: `contacts` is free-form text for the people connected to the posting, such as the hiring manager or a referral, with whatever details the user wants to keep (name, role, email, LinkedIn).

Note: recording `applied_on` locks the posting's resumes and cover letters: they're a record of what was sent. The app refuses changes to them (`VERSION_LOCKED`), and editing a library item they use saves a new row instead of changing the original. Clearing the date unlocks them. See "Sent versions are locked" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: `header_id` is the header the user chose for this posting, right after creating it. Every resume and cover letter for the posting uses it: changing it changes theirs, and they can't pick another (`VALIDATION_FAILED`). Once `applied_on` is set it's locked with them (`VERSION_LOCKED`). It uses `ON DELETE SET NULL`, so deleting a header never deletes a posting.

Note: a new resume or cover letter for a posting needs the posting to have a header (`VALIDATION_FAILED` otherwise), and a posting with `applied_on` set gets no new ones (`VERSION_LOCKED`). See "Starting a version for a posting" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

### interview
| Column       | Type      | Constraints                                               | Description                         |
|--------------|-----------|-----------------------------------------------------------|-------------------------------------|
| interview_id | SERIAL    | PRIMARY KEY                                               | unique interview id                 |
| account_id   | INTEGER   | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                |
| interview_on | DATE      | NOT NULL                                                  | date of the interview               |
| notes        | TEXT      |                                                           | round, who it was with, how it went |
| created_at   | TIMESTAMP | DEFAULT NOW()                                             | date/time interview added to db     |
| updated_at   | TIMESTAMP | DEFAULT NOW()                                             | date/time interview last updated    |

Note: one interview can cover several open positions at the same organization, so interviews link to job postings through `job_posting_interview` instead of storing a `job_posting_id`. A posting's interviews are shown in date order. An interview is reached through a posting it's linked to and stays linked to that one, so it always has at least one posting (a posting it isn't linked to returns `NOT_FOUND`).

### job_posting_interview
| Column         | Type    | Constraints                                                       | Description               |
|----------------|---------|-------------------------------------------------------------------|---------------------------|
| job_posting_id | INTEGER | NOT NULL REFERENCES job_posting(job_posting_id) ON DELETE CASCADE | id of related job posting |
| interview_id   | INTEGER | NOT NULL REFERENCES interview(interview_id) ON DELETE CASCADE     | id of related interview   |

Primary key: (job_posting_id, interview_id)

Note: links each interview to every posting it covered. Deleting a posting removes its links; the app also deletes any of its interviews that no other posting is linked to (see "Delete warnings" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### resume
| Column             | Type         | Constraints                                               | Description                                   |
|--------------------|--------------|-----------------------------------------------------------|-----------------------------------------------|
| resume_id          | SERIAL       | PRIMARY KEY                                               | unique resume id                              |
| account_id         | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                          |
| job_posting_id     | INTEGER      | REFERENCES job_posting(job_posting_id) ON DELETE CASCADE  | id of related job posting                     |
| name               | VARCHAR(204) | NOT NULL                                                  | label for this version                        |
| tone_set_id        | INTEGER      | REFERENCES tone_set(tone_set_id) ON DELETE SET NULL       | id of tone set used for this version          |
| header_id          | INTEGER      | REFERENCES header(header_id) ON DELETE SET NULL           | id of related header                          |
| based_on_resume_id | INTEGER      | REFERENCES resume(resume_id) ON DELETE SET NULL           | id of resume this version was copied from     |
| draft              | JSONB        |                                                           | Claude's suggestion awaiting first review     |
| hidden             | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the resume is hidden from new choices |
| created_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time resume added to db                  |
| updated_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time resume last updated                 |

Unique: (job_posting_id)

Note: `job_posting_id` is empty for a base resume, an ongoing starting point not made for a specific posting. A posting has at most one resume, which is edited in place until the posting is applied to; starting a second one returns `DUPLICATE` (the app checks first, to name the one that exists), and base resumes, with no posting, are unaffected. Seeded resumes are base resumes, or tailored versions for postings the user already applied to. A tailored version is named "[role title] at [organization]" when it's started, with no name to type (see "Starting a version for a posting" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)). For a base resume the user names it (e.g. "Tech", "Teaching"), and the app shows it with "Base Resume" after it ("Tech Base Resume").

Note: `name` is unique among the account's resumes, ignoring capitals (an app check: `DUPLICATE` for a typed name, and a number added to a posting's version, which the app names). See "Names of resumes and cover letters" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: `header_id` picks the name, headline, and contact details at the top. A resume for a job posting uses the posting's header, which is changed only on the posting. A copied base resume keeps its header until the user changes it. It uses `ON DELETE SET NULL`, so deleting a header never deletes a resume.

Note: `based_on_resume_id` uses `ON DELETE SET NULL`, an exception to cascading deletes. Deleting an older version shouldn't delete every resume copied from it.

Note: `hidden` sets a resume aside: it's listed last under "Hidden" and isn't offered to start a new one from. A sent (locked) resume can't be deleted (`VERSION_LOCKED`, an app check), only hidden, so the record of what went out is kept; deleting its posting still deletes it. See "Hiding" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: `tone_set_id` picks the tone rules applied to this version. It's optional and uses `ON DELETE SET NULL`, so deleting a tone set never deletes a resume. A copied resume keeps its tone set until the user changes it.

Note: `draft` holds Claude's suggestion for a posting's resume (the starting document and Claude's reason; each piece of Claude's reworded or new text once, by key, with the item it replaces and where Claude put it; then the sections, items, skills, and bullets by id, each with a reason, pointing to Claude's text by key, and whether the user went back to the original; for a cover letter, also the new sections Claude titled for its new paragraphs, once each by key, and the greeting Claude suggests, with its reason and whether the user keeps the letter's usual one instead; and the writing check's results: the rules each of Claude's texts still breaks and whether the check reworded it, the rules each library item in the draft breaks, and whether the check ran), with the user's edits during the first review. Nothing in it is saved to the resume or the library until "Approve first draft", which writes what the user kept and clears it. Empty when there's nothing to review. It's set only when a posting's resume is started with Claude (`VALIDATION_FAILED` for a base resume, `VERSION_LOCKED` once the posting is applied to), so there's one at a time, and recording the posting's applied date while one of its documents has a draft returns `VALIDATION_FAILED` (`applied_on`), so a sent version is never an unreviewed draft. The user's edits are checked like Claude's reply, and refused when they break it (`VALIDATION_FAILED`, `sections`), and finishing keeps for later only Claude's text the draft doesn't use (`VALIDATION_FAILED`, `keep`). A copy doesn't copy it. See "Claude's suggestions" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: base resumes can be edited directly at any time, but the database keeps no history, so earlier states are lost. Its page says so in a note above Copy, which makes a new base resume based on it, so the original stays available. Tailored versions are never edited to fit a different posting. Starting from any earlier resume copies all of its join rows (sections, items, sub-items) into a new resume, and the library items themselves are not copied.

### cover_letter
| Column             | Type         | Constraints                                               | Description                                         |
|--------------------|--------------|-----------------------------------------------------------|-----------------------------------------------------|
| letter_id          | SERIAL       | PRIMARY KEY                                               | unique cover letter id                              |
| account_id         | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                                |
| job_posting_id     | INTEGER      | REFERENCES job_posting(job_posting_id) ON DELETE CASCADE  | id of related job posting                           |
| name               | VARCHAR(204) | NOT NULL                                                  | label for this version                              |
| header_id          | INTEGER      | REFERENCES header(header_id) ON DELETE SET NULL           | id of related header                                |
| tone_set_id        | INTEGER      | REFERENCES tone_set(tone_set_id) ON DELETE SET NULL       | id of tone set used for this version                |
| based_on_letter_id | INTEGER      | REFERENCES cover_letter(letter_id) ON DELETE SET NULL     | id of cover letter this version was copied from     |
| addressee          | VARCHAR(100) |                                                           | who the greeting addresses: "Dear [addressee],"     |
| sign_off_id        | INTEGER      | REFERENCES sign_off(sign_off_id) ON DELETE SET NULL       | id of sign-off used before the name                 |
| signature_name     | VARCHAR(100) |                                                           | name under the sign-off, if not the header's        |
| draft              | JSONB        |                                                           | Claude's suggestion awaiting first review           |
| hidden             | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the cover letter is hidden from new choices |
| created_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time cover letter added to db                  |
| updated_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time cover letter last updated                 |

Unique: (job_posting_id)

Note: works the same way as `resume`, including at most one cover letter per posting, its `draft`, and `hidden`. `based_on_letter_id` uses `ON DELETE SET NULL` for the same reason.

Note: there's no direct link between a resume and a cover letter. Both are created under a job posting (`job_posting_id`) and use the posting's header, so they match; deleting one leaves the other in place.

Note: `sign_off_id` picks the closing (e.g. "Sincerely," then the name). New cover letters default to the account's "Sincerely". It uses `ON DELETE SET NULL`, so deleting a sign-off never deletes a cover letter.

Note: `signature_name` is the name printed under the sign-off. Empty means the header's `full_name`, so new letters leave it empty unless the user wants a different form of their name (e.g. without a nickname). The app shows the header's name in the field, and stores the header's name, typed back, as empty. A copied letter keeps it.

Note: `addressee` is everything after "Dear" in the greeting. It defaults to "[organization] Hiring Team", using the job posting's `organization` (or just "Hiring Team" when there's no posting). The user can replace it with anything, such as a hiring manager's name ("Ms. Rivera"). When a posting's letter is tailored by Claude and the posting (or its `contacts`) names who is hiring, Claude suggests that name in the draft, and approving the draft saves it here unless the user keeps the default. The app fills in the default, since a database default can't look up the organization.

### chat_message
| Column     | Type      | Constraints                                               | Description                                   |
|------------|-----------|-----------------------------------------------------------|-----------------------------------------------|
| message_id | SERIAL    | PRIMARY KEY                                               | unique chat message id                        |
| account_id | INTEGER   | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                          |
| resume_id  | INTEGER   | REFERENCES resume(resume_id) ON DELETE CASCADE            | id of related resume                          |
| letter_id  | INTEGER   | REFERENCES cover_letter(letter_id) ON DELETE CASCADE      | id of related cover letter                    |
| role       | chat_role | NOT NULL                                                  | who wrote the message: the user or Claude     |
| text       | TEXT      | NOT NULL                                                  | what the chat panel shows                     |
| about      | JSONB     |                                                           | the part of the document the message is about |
| content    | JSONB     | NOT NULL                                                  | content blocks as sent to or from Claude      |
| proposals  | JSONB     |                                                           | changes Claude proposed in the message        |
| created_at | TIMESTAMP | DEFAULT NOW()                                             | date/time chat message added to db            |
| updated_at | TIMESTAMP | DEFAULT NOW()                                             | date/time chat message last updated           |

Note: one row per turn of a resume's or cover letter's chat with Claude (see "Working with Claude at every level" in [APP_FLOW.md](APP_FLOW.md)), in the order added. Exactly one of `resume_id` and `letter_id` is set (a database check), so deleting the document deletes its chat. `role` uses a Postgres enum type, `chat_role`, with the values `user` and `assistant`.

Note: the conversation only grows. `content` is each turn exactly as Claude saw it or wrote it (for the user, the results of Claude's last proposals, the document and the posting's other document each when it changed, and what the message was about; for Claude, its thinking, reply, and tool calls), so every request replays the history unchanged, which keeps it cached and keeps Claude's thinking valid. `text` is the part the panel shows. A user turn's `about` names the document, a section, or an item (with any unsaved text from the item's dialog). An assistant turn's `proposals` lists Claude's proposed changes, each with its tool call id and a `state` (`pending`, `applied`, or `dismissed`, or `left_out` with why, for one that failed the app's checks and was never shown), and what the writing check found in its text (`flags`, `fixed`, and `checked`, false when the check failed); a change of state, or checking it again, updates that row, and the next user turn tells Claude what happened to each. A copy of a document doesn't copy its chat, and a sent (locked) one's chat can be read but gets no new messages (`VERSION_LOCKED`). See "Chat with Claude" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: app checks: a message's text is 1 to 4,000 characters, and what it's about must be in the document (`VALIDATION_FAILED`); Claude's proposals are checked against the library and the document like its suggestions, and those that fail aren't shown.

### section
| Column     | Type         | Constraints                                      | Description                                       |
|------------|--------------|--------------------------------------------------|---------------------------------------------------|
| id         | SERIAL       | PRIMARY KEY                                      | unique section id                                 |
| account_id | INTEGER      | REFERENCES account(account_id) ON DELETE CASCADE | id of owning account; empty for built-in sections |
| title      | VARCHAR(100) | NOT NULL                                         | heading of resume section or cover letter topic   |
| hidden     | BOOLEAN      | NOT NULL DEFAULT FALSE                           | whether the section is hidden from new choices    |
| created_at | TIMESTAMP    | DEFAULT NOW()                                    | date/time section added to db                     |
| updated_at | TIMESTAMP    | DEFAULT NOW()                                    | date/time section last updated                    |

Unique: (account_id, title)

Note: sections are shared by resumes and cover letters. The `title` is only a name. The app never reads it to decide what a section holds; the section's lists in the Library Join Tables (`section_narrative_content`, `section_skill_category`, and so on) record that instead. Resume section titles are printed in the resume. Cover letter section titles are descriptors for the user only (e.g. "EdTech paragraph") and are never shown in the letter.

Note: five built-in sections are created with the database, with fixed ids: "Summary" (1), "Skills" (2), "Experience" (3), "Projects" (4), and "Education" (5). The backend refers to them by these ids (constants in `backend/app/models.py`), never by title. They have no `account_id`, so every account shares them. They can't be deleted or renamed. Each resume or cover letter can use them or not.

Note: users can add any other sections they want (e.g. "Freelance and Consulting Experience", "Volunteer Experience", "Technical Skills", "EdTech paragraph").

Note: there are no content rules. Any kind of content (narrative content, skill categories, experience, projects, bullet points, education) can go in any section, including a mix of kinds in one section, and any section can be included in any resume. A new item is listed under the section it's created in. New skill categories, experience, projects, and education entries default to the built-in "Skills", "Experience", "Projects", and "Education" sections, and the user can choose another.

Note: the backend refuses to delete or rename a built-in section, and a database trigger blocks it as a backstop.

Note: titles are unique in the account, ignoring capitals and counting the built-in titles (the database checks exact matches; the app checks the rest and returns `DUPLICATE`). Renaming a section follows the same rules as every library item: resumes and cover letters in progress switch to the new title only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the new title is saved as a new section with the same lists (only the account's items, for a built-in section), and the picked ones switch to it. A built-in section can't be renamed, so a new title for one always saves a new section (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### narrative_content
| Column     | Type      | Constraints                                               | Description                                              |
|------------|-----------|-----------------------------------------------------------|----------------------------------------------------------|
| content_id | SERIAL    | PRIMARY KEY                                               | unique narrative content id                              |
| account_id | INTEGER   | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                                     |
| content    | TEXT      | NOT NULL                                                  | text of one sentence up to a paragraph                   |
| hidden     | BOOLEAN   | NOT NULL DEFAULT FALSE                                    | whether the narrative content is hidden from new choices |
| created_at | TIMESTAMP | DEFAULT NOW()                                             | date/time narrative content added to db                  |
| updated_at | TIMESTAMP | DEFAULT NOW()                                             | date/time narrative content last updated                 |

Note: each row (an "excerpt" in the app) holds anything from one sentence to a full paragraph. Narrative sections, such as a resume summary or a cover letter paragraph, combine the excerpts chosen and ordered by `position` in `resume_narrative_content` / `cover_letter_narrative_content`. The user decides how to split text: for example, a paragraph used in many resumes with only its first sentence changed can be one row per first sentence plus one row for the rest of the paragraph. No label column is needed, because sections list their excerpts in `section_narrative_content`.

Note: editing an excerpt's text follows the same rules as every library item: resumes and cover letters in progress switch to the edited excerpt only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the edit is saved as a new row, listed right after the original in its sections (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

Note: a rewording of Claude's that the user keeps is saved as a new row, listed under the same sections as the original, and the original is never overwritten. Only the current resume or cover letter switches to the new row (see "Rewordings" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### skill_category
| Column        | Type         | Constraints                                      | Description                                           |
|---------------|--------------|--------------------------------------------------|-------------------------------------------------------|
| category_id   | SERIAL       | PRIMARY KEY                                      | unique skill category id                              |
| account_id    | INTEGER      | REFERENCES account(account_id) ON DELETE CASCADE | id of owning account; empty for built-in "Other"      |
| category_name | VARCHAR(100) | NOT NULL                                         | name of skill category                                |
| hidden        | BOOLEAN      | NOT NULL DEFAULT FALSE                           | whether the skill category is hidden from new choices |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                    | date/time skill category added to db                  |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                    | date/time skill category last updated                 |

Note: a category lists its skills in `skill_category_skill`, and sections list their categories in `section_skill_category`.

Note: names are unique in the account, ignoring capitals and counting "Other". The app checks this and returns `DUPLICATE`.

Note: a built-in "Other" category is created with the database, with the fixed id 1 and no `account_id` (every account shares it). It can't be deleted or renamed; the backend refuses, and a database trigger blocks it as a backstop. Skills with no better category go in "Other". It isn't listed under any section; the app offers it wherever skills are being added.

Note: when a category is deleted, the app first lists any of its skills that no other category lists under "Other", and moves its resume and cover letter selections under "Other" in the same section, so no skill is left without a category and no resume loses skills. See "Deleting a skill category" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Note: renaming a category follows the same rules as every library item: resumes and cover letters in progress switch to the new name only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the new name is saved as a new category, listed right after the original in its sections and listing the same skills (only the account's, for "Other"). "Other" can't be renamed, so a new name for it always saves a new category (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### skill
| Column     | Type         | Constraints                                               | Description                                  |
|------------|--------------|-----------------------------------------------------------|----------------------------------------------|
| skill_id   | SERIAL       | PRIMARY KEY                                               | unique skill id                              |
| account_id | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                         |
| skill_name | VARCHAR(100) | NOT NULL                                                  | name of skill                                |
| hidden     | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the skill is hidden from new choices |
| created_at | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill added to db                  |
| updated_at | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill last updated                 |

Note: a skill can be listed under any number of categories (`skill_category_skill`) and projects (`project_skill`). When a category is added to a resume, the app suggests skills from the category's list, in its default order.

Note: names are unique in the account, ignoring capitals. The app checks this and returns `DUPLICATE`.

Note: every skill is listed under at least one category. Taking a skill out of its only category lists it under "Other" (an app rule; see "Suggesting and adding items" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

Note: renaming a skill follows the same rules as every library item: resumes and cover letters in progress switch to the new name only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the new name is saved as a new skill, listed right after the original in every category and project (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### experience
| Column        | Type         | Constraints                                               | Description                                       |
|---------------|--------------|-----------------------------------------------------------|---------------------------------------------------|
| experience_id | SERIAL       | PRIMARY KEY                                               | unique experience id                              |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                              |
| role_title    | VARCHAR(100) | NOT NULL                                                  | title of role held                                |
| organization  | VARCHAR(100) | NOT NULL                                                  | name of employer or organization                  |
| location      | VARCHAR(100) |                                                           | city/state and/or remote                          |
| dates         | VARCHAR(50)  |                                                           | dates worked (e.g. Jan 2020 – Present)            |
| hidden        | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the experience is hidden from new choices |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time experience added to db                  |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time experience last updated                 |

Note: an experience is any role: a paid job, volunteer work, or anything else. Each version of a role is its own row (e.g. "Software Engineer" and "Senior Software Engineer" at the same organization, or the same role with dates written differently on an older resume). The versions can list the same bullets in `experience_bullet_point`, so the bullets are stored once. A version saved from an edit is listed right after the original in its sections and lists the same bullets. Resumes and cover letters in progress switch to an edited role only if the user picks them, and sent ones never do (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### project
| Column        | Type         | Constraints                                               | Description                                    |
|---------------|--------------|-----------------------------------------------------------|------------------------------------------------|
| project_id    | SERIAL       | PRIMARY KEY                                               | unique project id                              |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                           |
| project_title | VARCHAR(100) | NOT NULL                                                  | name of project                                |
| done_for      | VARCHAR(100) |                                                           | who or what the project is affiliated with     |
| url           | TEXT         |                                                           | link to the project (repo, demo, or write-up)  |
| dates         | VARCHAR(50)  |                                                           | dates worked as displayed (e.g. Spring 2024)   |
| hidden        | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the project is hidden from new choices |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time project added to db                  |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time project last updated                 |

Note: a project lists its skills in `project_skill` and its bullets in `project_bullet_point`.

Note: `done_for` is optional free text naming who or what the project is affiliated with, printed as written (e.g. "McGraw Hill", "Freelance", "Independent project"). Empty means the project line shows nothing there.

Note: each version of a project is its own row, like a role's versions. A version saved from an edit is listed right after the original in its sections and lists the same skills and bullets. Resumes and cover letters in progress switch to an edited project only if the user picks them, and sent ones never do (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### bullet_point
| Column     | Type      | Constraints                                               | Description                                         |
|------------|-----------|-----------------------------------------------------------|-----------------------------------------------------|
| bullet_id  | SERIAL    | PRIMARY KEY                                               | unique bullet point id                              |
| account_id | INTEGER   | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                                |
| content    | TEXT      | NOT NULL                                                  | text of bullet point                                |
| hidden     | BOOLEAN   | NOT NULL DEFAULT FALSE                                    | whether the bullet point is hidden from new choices |
| created_at | TIMESTAMP | DEFAULT NOW()                                             | date/time bullet point added to db                  |
| updated_at | TIMESTAMP | DEFAULT NOW()                                             | date/time bullet point last updated                 |

Note: a bullet is listed under roles (`experience_bullet_point`), projects (`project_bullet_point`), or directly under sections (`section_bullet_point`), as many as fit.

Note: editing a bullet's text follows the same rules as every library item: resumes and cover letters in progress switch to the edited bullet only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the edit is saved as a new row, listed right after the original (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

Note: a rewording of Claude's that the user keeps is saved as a new row, listed under every role, project, and section that lists the original, and the original is never overwritten. Only the current resume or cover letter switches to the new bullet (see "Rewordings" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### education
| Column       | Type         | Constraints                                               | Description                                                              |
|--------------|--------------|-----------------------------------------------------------|--------------------------------------------------------------------------|
| education_id | SERIAL       | PRIMARY KEY                                               | unique education id                                                      |
| account_id   | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                                                     |
| degree       | VARCHAR(100) | NOT NULL                                                  | degree and field of study (e.g. B.A. in English)                         |
| institution  | VARCHAR(100) | NOT NULL                                                  | name of school or institution                                            |
| details      | TEXT         |                                                           | optional details about education                                         |
| graduation   | VARCHAR(100) |                                                           | graduation date and honors as displayed (e.g. May 2015, magna cum laude) |
| hidden       | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the education is hidden from new choices                         |
| created_at   | TIMESTAMP    | DEFAULT NOW()                                             | date/time education added to db                                          |
| updated_at   | TIMESTAMP    | DEFAULT NOW()                                             | date/time education last updated                                         |

Note: editing an entry follows the same rules as every library item: resumes and cover letters in progress switch to the edited entry only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the edit is saved as a new entry, listed right after the original in its sections (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### writing_rule
| Column          | Type              | Constraints                                               | Description                                        |
|-----------------|-------------------|-----------------------------------------------------------|----------------------------------------------------|
| writing_rule_id | SERIAL            | PRIMARY KEY                                               | unique writing rule id                             |
| account_id      | INTEGER           | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                               |
| kind            | writing_rule_kind | NOT NULL                                                  | term (exact word or phrase) or pattern (described) |
| rule_text       | TEXT              | NOT NULL                                                  | banned word/phrase, or description of the pattern  |
| active          | BOOLEAN           | NOT NULL DEFAULT TRUE                                     | whether the rule is currently applied              |
| created_at      | TIMESTAMP         | DEFAULT NOW()                                             | date/time writing rule added to db                 |
| updated_at      | TIMESTAMP         | DEFAULT NOW()                                             | date/time writing rule last updated                |

Note: the banned filler and AI-speak list from [WRITING_RULES.md](WRITING_RULES.md). Every rule applies to every resume and cover letter in the account. `kind` uses a Postgres enum type, `writing_rule_kind`, with the values `term` and `pattern`. A `term` (e.g. "leverage", "proven track record") is found in code (whole words, ignoring capitals, with a single word's usual endings); a `pattern` (e.g. "lists of three used for rhythm") is a description Claude checks for. Exceptions for technical terms and proper nouns are Claude's judgment, as described in WRITING_RULES.md.

Note: each account is seeded with the starting list in WRITING_RULES.md. Setting `active` to false switches a rule off without deleting it.

### tone_set
| Column      | Type         | Constraints                                               | Description                                      |
|-------------|--------------|-----------------------------------------------------------|--------------------------------------------------|
| tone_set_id | SERIAL       | PRIMARY KEY                                               | unique tone set id                               |
| account_id  | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                             |
| name        | VARCHAR(100) | NOT NULL                                                  | label for the tone set (e.g. "Tech", "Teaching") |
| hidden      | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the tone set is hidden from new choices  |
| created_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time tone set added to db                   |
| updated_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time tone set last updated                  |

Note: a named group of tone rules. Each resume and cover letter can use one tone set through `tone_set_id`. The app calls a tone set a "tone" everywhere the user sees it.

Note: a new tone set's name, or a new name for one, must be new in the account, ignoring capitals (the app checks and returns `DUPLICATE`). A set saved from an edit as a new row can keep its original's name, so two sets can share one; the app tells them apart by `created_at`.

Note: a tone set is saved whole: its name and its rules, in order. Tones aren't printed, but a sent resume or cover letter keeps the tone it was written with, so editing one follows the same rules as every library item: resumes and cover letters in progress switch to the edited set only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent version uses it, the edit is saved as a new set with copies of the rules (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### tone_rule
| Column       | Type         | Constraints                                                 | Description                                           |
|--------------|--------------|-------------------------------------------------------------|-------------------------------------------------------|
| tone_rule_id | SERIAL       | PRIMARY KEY                                                 | unique tone rule id                                   |
| tone_set_id  | INTEGER      | NOT NULL REFERENCES tone_set(tone_set_id) ON DELETE CASCADE | id of related tone set                                |
| rule_text    | TEXT         | NOT NULL                                                    | tone instruction (e.g. "Lead with tools and metrics") |
| position     | INTEGER      | NOT NULL                                                    | order of rule in the tone set                         |
| created_at   | TIMESTAMP    | DEFAULT NOW()                                               | date/time tone rule added to db                       |
| updated_at   | TIMESTAMP    | DEFAULT NOW()                                               | date/time tone rule last updated                      |

Note: deleting a tone set deletes its rules. Saving a set sends its rules in order: each kept rule with its `tone_rule_id` at most once, and new ones without; rules left out are deleted. An id that isn't one of the set's rules, or one sent twice, returns `VALIDATION_FAILED` (see "Writing rules" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### sign_off
| Column      | Type         | Constraints                                               | Description                                        |
|-------------|--------------|-----------------------------------------------------------|----------------------------------------------------|
| sign_off_id | SERIAL       | PRIMARY KEY                                               | unique sign-off id                                 |
| account_id  | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                               |
| text        | VARCHAR(100) | NOT NULL                                                  | closing word(s) before the name (e.g. "Sincerely") |
| hidden      | BOOLEAN      | NOT NULL DEFAULT FALSE                                    | whether the sign-off is hidden from new choices    |
| created_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time sign-off added to db                     |
| updated_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time sign-off last updated                    |

Note: each account starts with "Sincerely", and the user can add others (e.g. "Best regards"). A cover letter ends with its sign-off, a comma, and its `signature_name` (or its header's `full_name`) on the next line. No sign-off means no closing.

Note: editing a sign-off follows the same rules as every library item: cover letters in progress switch to the new text only if the user picks them, and sent ones never do. Unless every one in progress is picked and no sent letter uses it, the new text is saved as a new sign-off (see "Changing an item" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

## Library Join Tables
Each parent lists every child that can go under it. These lists are what the app suggests from (e.g. a role's bullets, a category's skills), and `position` is the default order for a new resume. They don't limit where an item can go: a resume can still place any item in any section.

Conventions for every library join table:
- The primary key is the (parent, child) pair, so a child is listed under a parent only once. They need no id of their own, since nothing references them.
- One child can be listed under many parents (a bullet under two versions of a role, a skill in two categories).
- Deleting the parent or the child removes the row. Deleting a parent never deletes its children; an item listed under no parent stays in the library, and the app shows it so it can be listed again.
- No `created_at`/`updated_at`.

### section_narrative_content
| Column     | Type    | Constraints                                                         | Description                                   |
|------------|---------|---------------------------------------------------------------------|-----------------------------------------------|
| section_id | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE                   | id of related section                         |
| content_id | INTEGER | NOT NULL REFERENCES narrative_content(content_id) ON DELETE CASCADE | id of related narrative content               |
| position   | INTEGER | NOT NULL                                                            | default order of narrative content in section |

Primary key: (section_id, content_id)

Note: the narrative content that can go in this section, such as every summary sentence or paragraph the user has written.

Note: rows are added and removed from either side: the Sections page edits a section's list, and the Narrative content page's add and edit forms choose every section that lists an excerpt. Choosing sections for an excerpt keeps its position where it's already listed and lists it last in newly chosen sections. Changing these rows never makes a new excerpt, since they aren't printed.

### section_skill_category
| Column      | Type    | Constraints                                                       | Description                                |
|-------------|---------|-------------------------------------------------------------------|--------------------------------------------|
| section_id  | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE                 | id of related section                      |
| category_id | INTEGER | NOT NULL REFERENCES skill_category(category_id) ON DELETE CASCADE | id of related skill category               |
| position    | INTEGER | NOT NULL                                                          | default order of skill category in section |

Primary key: (section_id, category_id)

Note: the skill categories that can go in this section. The built-in "Other" category isn't listed; the app offers it wherever skills are added.

### section_experience
| Column        | Type    | Constraints                                                     | Description                            |
|---------------|---------|-----------------------------------------------------------------|----------------------------------------|
| section_id    | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE               | id of related section                  |
| experience_id | INTEGER | NOT NULL REFERENCES experience(experience_id) ON DELETE CASCADE | id of related experience               |
| position      | INTEGER | NOT NULL                                                        | default order of experience in section |

Primary key: (section_id, experience_id)

Note: the roles that can go in this section (e.g. paid jobs under "Experience", gigs under a freelance section).

### section_project
| Column     | Type    | Constraints                                               | Description                         |
|------------|---------|-----------------------------------------------------------|-------------------------------------|
| section_id | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section               |
| project_id | INTEGER | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE | id of related project               |
| position   | INTEGER | NOT NULL                                                  | default order of project in section |

Primary key: (section_id, project_id)

Note: the projects that can go in this section.

### section_bullet_point
| Column     | Type    | Constraints                                                   | Description                              |
|------------|---------|---------------------------------------------------------------|------------------------------------------|
| section_id | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE             | id of related section                    |
| bullet_id  | INTEGER | NOT NULL REFERENCES bullet_point(bullet_id) ON DELETE CASCADE | id of related bullet point               |
| position   | INTEGER | NOT NULL                                                      | default order of bullet point in section |

Primary key: (section_id, bullet_id)

Note: bullets that stand on their own directly in this section, not under a role or project.

### section_education
| Column       | Type    | Constraints                                                   | Description                           |
|--------------|---------|---------------------------------------------------------------|---------------------------------------|
| section_id   | INTEGER | NOT NULL REFERENCES section(id) ON DELETE CASCADE             | id of related section                 |
| education_id | INTEGER | NOT NULL REFERENCES education(education_id) ON DELETE CASCADE | id of related education               |
| position     | INTEGER | NOT NULL                                                      | default order of education in section |

Primary key: (section_id, education_id)

Note: the education entries that can go in this section.

### skill_category_skill
| Column      | Type    | Constraints                                                       | Description                              |
|-------------|---------|-------------------------------------------------------------------|------------------------------------------|
| category_id | INTEGER | NOT NULL REFERENCES skill_category(category_id) ON DELETE CASCADE | id of related skill category             |
| skill_id    | INTEGER | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE             | id of related skill                      |
| position    | INTEGER | NOT NULL                                                          | default order of skill in skill category |

Primary key: (category_id, skill_id)

Note: the skills in this category. A skill can be listed in more than one category.

### project_skill
| Column     | Type    | Constraints                                               | Description                       |
|------------|---------|-----------------------------------------------------------|-----------------------------------|
| project_id | INTEGER | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE | id of related project             |
| skill_id   | INTEGER | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE     | id of related skill               |
| position   | INTEGER | NOT NULL                                                  | default order of skill in project |

Primary key: (project_id, skill_id)

Note: the full list of skills used on a project, which the app suggests from. Which of these skills appear on a given resume is chosen per resume in `resume_project_skill`.

### experience_bullet_point
| Column        | Type    | Constraints                                                     | Description                                 |
|---------------|---------|-----------------------------------------------------------------|---------------------------------------------|
| experience_id | INTEGER | NOT NULL REFERENCES experience(experience_id) ON DELETE CASCADE | id of related experience                    |
| bullet_id     | INTEGER | NOT NULL REFERENCES bullet_point(bullet_id) ON DELETE CASCADE   | id of related bullet point                  |
| position      | INTEGER | NOT NULL                                                        | default order of bullet point in experience |

Primary key: (experience_id, bullet_id)

Note: every bullet that can go under this role. Versions of the same role (e.g. a different title or dates) list the same bullets, so each bullet is stored once. The app suggests a subset of this list for each resume.

### project_bullet_point
| Column     | Type    | Constraints                                                   | Description                              |
|------------|---------|---------------------------------------------------------------|------------------------------------------|
| project_id | INTEGER | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE     | id of related project                    |
| bullet_id  | INTEGER | NOT NULL REFERENCES bullet_point(bullet_id) ON DELETE CASCADE | id of related bullet point               |
| position   | INTEGER | NOT NULL                                                      | default order of bullet point in project |

Primary key: (project_id, bullet_id)

Note: every bullet that can go under this project. The app suggests a subset of this list for each resume.

## Join Tables
A resume or cover letter is built as a tree of the user's selections: resume or cover letter → sections → items in each section → sub-items (skills in a category, skills in a project, bullets in an experience or project).
Each join row has its own id so the next level down can reference that specific selection, letting the same skill category show different skills on different resumes.

Conventions for every join table:
- `position` orders items under the same parent. Lower numbers appear first.
- A section can mix item types (e.g. a narrative content excerpt, then two experience items). Items directly in the same section share one numbering across all join tables (`resume_narrative_content`, `resume_skill_category`, `resume_experience`, `resume_project`, `resume_bullet_point`, `resume_education`, and the cover letter equivalents), so the app can interleave them. The app assigns these numbers, since the database can't check positions across tables.
- A `Unique:` line lists columns whose combination can't repeat, so the same item can't be picked twice under one parent.
- No `created_at`/`updated_at`. Changing a selection updates the parent resume's or cover letter's `updated_at`.

**Resume join tables**

### resume_section
| Column            | Type         | Constraints                                             | Description                |
|-------------------|--------------|---------------------------------------------------------|----------------------------|
| resume_section_id | SERIAL       | PRIMARY KEY                                             | unique resume section id   |
| resume_id         | INTEGER      | NOT NULL REFERENCES resume(resume_id) ON DELETE CASCADE | id of related resume       |
| section_id        | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE       | id of related section      |
| position          | INTEGER      | NOT NULL                                                | order of section in resume |

Unique: (resume_id, section_id)

### resume_narrative_content
| Column                      | Type         | Constraints                                                             | Description                        |
|-----------------------------|--------------|-------------------------------------------------------------------------|------------------------------------|
| resume_narrative_content_id | SERIAL       | PRIMARY KEY                                                             | unique resume narrative content id |
| resume_section_id           | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section       |
| content_id                  | INTEGER      | NOT NULL REFERENCES narrative_content(content_id) ON DELETE CASCADE     | id of related narrative content    |
| position                    | INTEGER      | NOT NULL                                                                | order of content in section        |

Unique: (resume_section_id, content_id)

### resume_skill_category
| Column                   | Type         | Constraints                                                             | Description                     |
|--------------------------|--------------|-------------------------------------------------------------------------|---------------------------------|
| resume_skill_category_id | SERIAL       | PRIMARY KEY                                                             | unique resume skill category id |
| resume_section_id        | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section    |
| category_id              | INTEGER      | NOT NULL REFERENCES skill_category(category_id) ON DELETE CASCADE       | id of related skill category    |
| position                 | INTEGER      | NOT NULL                                                                | order of category in section    |

Unique: (resume_section_id, category_id)

### resume_skill
| Column                   | Type         | Constraints                                                                           | Description                         |
|--------------------------|--------------|---------------------------------------------------------------------------------------|-------------------------------------|
| resume_skill_id          | SERIAL       | PRIMARY KEY                                                                           | unique resume skill id              |
| resume_skill_category_id | INTEGER      | NOT NULL REFERENCES resume_skill_category(resume_skill_category_id) ON DELETE CASCADE | id of related resume skill category |
| skill_id                 | INTEGER      | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE                                 | id of related skill                 |
| position                 | INTEGER      | NOT NULL                                                                              | order of skill in category          |

Unique: (resume_skill_category_id, skill_id)

Note: the database doesn't check that the skill is listed under the selected category in `skill_category_skill`. Any of the account's skills can be picked, since skill sets overlap; one the category doesn't list yet is listed last under it in `skill_category_skill` too, in the same transaction. Undo can put back one the category no longer lists, since it restores what the resume showed (see "Undo" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)).

### resume_experience
| Column               | Type         | Constraints                                                             | Description                    |
|----------------------|--------------|-------------------------------------------------------------------------|--------------------------------|
| resume_experience_id | SERIAL       | PRIMARY KEY                                                             | unique resume experience id    |
| resume_section_id    | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section   |
| experience_id        | INTEGER      | NOT NULL REFERENCES experience(experience_id) ON DELETE CASCADE         | id of related experience       |
| position             | INTEGER      | NOT NULL                                                                | order of experience in section |

Unique: (resume_section_id, experience_id)

### resume_project
| Column            | Type         | Constraints                                                             | Description                  |
|-------------------|--------------|-------------------------------------------------------------------------|------------------------------|
| resume_project_id | SERIAL       | PRIMARY KEY                                                             | unique resume project id     |
| resume_section_id | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section |
| project_id        | INTEGER      | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE               | id of related project        |
| position          | INTEGER      | NOT NULL                                                                | order of project in section  |

Unique: (resume_section_id, project_id)

### resume_project_skill
| Column                  | Type         | Constraints                                                             | Description                              |
|-------------------------|--------------|-------------------------------------------------------------------------|------------------------------------------|
| resume_project_skill_id | SERIAL       | PRIMARY KEY                                                             | unique resume project skill id           |
| resume_project_id       | INTEGER      | NOT NULL REFERENCES resume_project(resume_project_id) ON DELETE CASCADE | id of related resume project             |
| skill_id                | INTEGER      | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE                   | id of related skill                      |
| position                | INTEGER      | NOT NULL                                                                | order of skill in project on this resume |

Unique: (resume_project_id, skill_id)

Note: lets each resume show a different set of skills for the same project, chosen to match the job. The app suggests skills from `project_skill` for that project. Any of the account's skills can be picked; one the project doesn't list yet is listed last under it in `project_skill` too, in the same transaction.

### resume_bullet_point
| Column                 | Type         | Constraints                                                             | Description                     |
|------------------------|--------------|-------------------------------------------------------------------------|---------------------------------|
| resume_bullet_point_id | SERIAL       | PRIMARY KEY                                                             | unique resume bullet point id   |
| resume_section_id      | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section    |
| resume_experience_id   | INTEGER      | REFERENCES resume_experience(resume_experience_id) ON DELETE CASCADE    | id of related resume experience |
| resume_project_id      | INTEGER      | REFERENCES resume_project(resume_project_id) ON DELETE CASCADE          | id of related resume project    |
| bullet_id              | INTEGER      | NOT NULL REFERENCES bullet_point(bullet_id) ON DELETE CASCADE           | id of related bullet point      |
| position               | INTEGER      | NOT NULL                                                                | order of bullet in its parent   |

Unique: (resume_section_id, bullet_id)

Note: set `resume_experience_id` or `resume_project_id` when the bullet sits under an experience or project on this resume. Leave both empty for a bullet listed directly in the section. Unlike skills, which can go under any category or project, the app only offers bullets listed under the selected experience or project (`experience_bullet_point` / `project_bullet_point`), and parents from the same resume section; undo can put back one no longer listed.

### resume_education
| Column              | Type         | Constraints                                                             | Description                   |
|---------------------|--------------|-------------------------------------------------------------------------|-------------------------------|
| resume_education_id | SERIAL       | PRIMARY KEY                                                             | unique resume education id    |
| resume_section_id   | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section  |
| education_id        | INTEGER      | NOT NULL REFERENCES education(education_id) ON DELETE CASCADE           | id of related education       |
| position            | INTEGER      | NOT NULL                                                                | order of education in section |

Unique: (resume_section_id, education_id)

**Cover letter join tables**

Cover letters use the same structure as resumes, so any kind of content can go in a cover letter section. Most cover letter sections are paragraphs built from narrative content, but the user can add skills, experience, projects, bullets, or education as they see fit.

### cover_letter_section
| Column                  | Type         | Constraints                                                   | Description                      |
|-------------------------|--------------|---------------------------------------------------------------|----------------------------------|
| cover_letter_section_id | SERIAL       | PRIMARY KEY                                                   | unique cover letter section id   |
| letter_id               | INTEGER      | NOT NULL REFERENCES cover_letter(letter_id) ON DELETE CASCADE | id of related cover letter       |
| section_id              | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE             | id of related section            |
| position                | INTEGER      | NOT NULL                                                      | order of section in cover letter |

Unique: (letter_id, section_id)

### cover_letter_narrative_content
| Column                            | Type         | Constraints                                                                         | Description                              |
|-----------------------------------|--------------|-------------------------------------------------------------------------------------|------------------------------------------|
| cover_letter_narrative_content_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter narrative content id |
| cover_letter_section_id           | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section       |
| content_id                        | INTEGER      | NOT NULL REFERENCES narrative_content(content_id) ON DELETE CASCADE                 | id of related narrative content          |
| position                          | INTEGER      | NOT NULL                                                                            | order of content in section              |

Unique: (cover_letter_section_id, content_id)

### cover_letter_skill_category
| Column                         | Type         | Constraints                                                                         | Description                           |
|--------------------------------|--------------|-------------------------------------------------------------------------------------|---------------------------------------|
| cover_letter_skill_category_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter skill category id |
| cover_letter_section_id        | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section    |
| category_id                    | INTEGER      | NOT NULL REFERENCES skill_category(category_id) ON DELETE CASCADE                   | id of related skill category          |
| position                       | INTEGER      | NOT NULL                                                                            | order of category in section          |

Unique: (cover_letter_section_id, category_id)

### cover_letter_skill
| Column                         | Type         | Constraints                                                                                       | Description                               |
|--------------------------------|--------------|---------------------------------------------------------------------------------------------------|-------------------------------------------|
| cover_letter_skill_id          | SERIAL       | PRIMARY KEY                                                                                       | unique cover letter skill id              |
| cover_letter_skill_category_id | INTEGER      | NOT NULL REFERENCES cover_letter_skill_category(cover_letter_skill_category_id) ON DELETE CASCADE | id of related cover letter skill category |
| skill_id                       | INTEGER      | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE                                             | id of related skill                       |
| position                       | INTEGER      | NOT NULL                                                                                          | order of skill in category                |

Unique: (cover_letter_skill_category_id, skill_id)

### cover_letter_experience
| Column                     | Type         | Constraints                                                                         | Description                        |
|----------------------------|--------------|-------------------------------------------------------------------------------------|------------------------------------|
| cover_letter_experience_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter experience id  |
| cover_letter_section_id    | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section |
| experience_id              | INTEGER      | NOT NULL REFERENCES experience(experience_id) ON DELETE CASCADE                     | id of related experience           |
| position                   | INTEGER      | NOT NULL                                                                            | order of experience in section     |

Unique: (cover_letter_section_id, experience_id)

### cover_letter_project
| Column                  | Type         | Constraints                                                                         | Description                        |
|-------------------------|--------------|-------------------------------------------------------------------------------------|------------------------------------|
| cover_letter_project_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter project id     |
| cover_letter_section_id | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section |
| project_id              | INTEGER      | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE                           | id of related project              |
| position                | INTEGER      | NOT NULL                                                                            | order of project in section        |

Unique: (cover_letter_section_id, project_id)

### cover_letter_project_skill
| Column                        | Type         | Constraints                                                                         | Description                              |
|-------------------------------|--------------|-------------------------------------------------------------------------------------|------------------------------------------|
| cover_letter_project_skill_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter project skill id     |
| cover_letter_project_id       | INTEGER      | NOT NULL REFERENCES cover_letter_project(cover_letter_project_id) ON DELETE CASCADE | id of related cover letter project       |
| skill_id                      | INTEGER      | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE                               | id of related skill                      |
| position                      | INTEGER      | NOT NULL                                                                            | order of skill in project in this letter |

Unique: (cover_letter_project_id, skill_id)

### cover_letter_bullet_point
| Column                       | Type         | Constraints                                                                         | Description                           |
|------------------------------|--------------|-------------------------------------------------------------------------------------|---------------------------------------|
| cover_letter_bullet_point_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter bullet point id   |
| cover_letter_section_id      | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section    |
| cover_letter_experience_id   | INTEGER      | REFERENCES cover_letter_experience(cover_letter_experience_id) ON DELETE CASCADE    | id of related cover letter experience |
| cover_letter_project_id      | INTEGER      | REFERENCES cover_letter_project(cover_letter_project_id) ON DELETE CASCADE          | id of related cover letter project    |
| bullet_id                    | INTEGER      | NOT NULL REFERENCES bullet_point(bullet_id) ON DELETE CASCADE                       | id of related bullet point            |
| position                     | INTEGER      | NOT NULL                                                                            | order of bullet in its parent         |

Unique: (cover_letter_section_id, bullet_id)

Note: works the same way as `resume_bullet_point`.

### cover_letter_education
| Column                    | Type         | Constraints                                                                         | Description                        |
|---------------------------|--------------|-------------------------------------------------------------------------------------|------------------------------------|
| cover_letter_education_id | SERIAL       | PRIMARY KEY                                                                         | unique cover letter education id   |
| cover_letter_section_id   | INTEGER      | NOT NULL REFERENCES cover_letter_section(cover_letter_section_id) ON DELETE CASCADE | id of related cover letter section |
| education_id              | INTEGER      | NOT NULL REFERENCES education(education_id) ON DELETE CASCADE                       | id of related education            |
| position                  | INTEGER      | NOT NULL                                                                            | order of education in section      |

Unique: (cover_letter_section_id, education_id)
