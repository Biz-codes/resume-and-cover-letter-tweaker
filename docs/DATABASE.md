# Database

## Overview
Holds sections, bullet points for resume and content for cover letter.

Every resume and cover letter is saved as its own version. There are two kinds:
- **Base resumes / cover letters** have no job posting. They're ongoing starting points the user returns to and keeps updating over time.
- **Tailored versions** are linked to the job posting they were made for.

A new version can start as a copy of any earlier one, base or tailored.

The database will be seeded with the user's existing resume data as a starting point, as base resumes (no job posting). Every seeded library item must be assigned to a section.

Seeding uses two SQL files, run after the schema migrations:
- **Starting data (committed):** the five built-in sections and each account's starting writing rules.
- **Personal data (not committed):** the user's account, library items, and base resumes, translated into `INSERT` statements from their existing resumes (PDF or pasted text). It contains personal information, so it's listed in `.gitignore`.

Everything belongs to an `account`. Only one account exists for now (the app runs locally for its owner), but the schema is ready for multiple accounts later. The account holds the header details (name, contact details, links), and each resume sets its own `headline`.

The database has two layers:
- **Tables** are a reusable library of content (sections, skills, experience, bullet points, etc.). Each item is written once.
- **Join Tables** record what a specific resume or cover letter uses: which library items the user selected, how they nest, and in what order.

All `updated_at` columns default to the time the row is created. The app (or a database trigger) must set `updated_at` whenever a row is edited.

Every foreign key uses `ON DELETE CASCADE`: deleting a row also deletes every row that refers to it, all the way down (e.g. deleting a skill removes it from every project and resume that uses it). The exceptions use `ON DELETE SET NULL`: `based_on_resume_id` / `based_on_letter_id`, so deleting an older version doesn't delete the versions copied from it, and `tone_set_id` on `resume` / `cover_letter`, so deleting a tone set only clears it from the resumes and cover letters that used it. The front end warns the user before a delete and explains what else will be removed.

Checks the app must handle (delete warnings, which items to suggest, timestamp updates) are listed in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md).

Join tables (including `project_skill`) have no timestamps. When a resume's or cover letter's selections change, the app updates that resume's or cover letter's `updated_at` instead.

## Tables
Every library table that holds section content (`narrative_content`, `skill_category`, `experience`, `project`, `bullet_point`, `education`) has a required `section_id`. It's the item's home section: where it's usually used, and where the app looks first when suggesting content for a section. It doesn't limit where the item can go. Skills belong to a section through their category. The join tables decide which items actually appear in a given resume or cover letter, and in which section; any item can go in any section.

### account
| Column        | Type         | Constraints   | Description                              |
|---------------|--------------|---------------|------------------------------------------|
| account_id    | SERIAL       | PRIMARY KEY   | unique account id                        |
| full_name     | VARCHAR(100) | NOT NULL      | name shown in the header                 |
| email         | VARCHAR(255) |               | contact email shown in the header        |
| phone         | VARCHAR(50)  |               | contact phone number shown in the header |
| location      | VARCHAR(100) |               | city/state shown in the header           |
| linkedin_url  | TEXT         |               | LinkedIn link shown in the header        |
| github_url    | TEXT         |               | GitHub link shown in the header          |
| portfolio_url | TEXT         |               | portfolio link shown in the header       |
| created_at    | TIMESTAMP    | DEFAULT NOW() | date/time account added to db            |
| updated_at    | TIMESTAMP    | DEFAULT NOW() | date/time account last updated           |

Note: one row for now (the app's owner). Holds the header details shown on every resume and cover letter. Login fields such as a password will be added when multiple accounts are needed. Every top-level table has an `account_id`; join tables belong to an account through their resume or cover letter.

### job_posting
| Column         | Type         | Constraints                                               | Description                                     |
|----------------|--------------|-----------------------------------------------------------|-------------------------------------------------|
| job_posting_id | SERIAL       | PRIMARY KEY                                               | unique job posting id                           |
| account_id     | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                            |
| url            | TEXT         | NOT NULL                                                  | url of the job posting                          |
| company        | VARCHAR(100) | NOT NULL                                                  | name of hiring company                          |
| job_title      | VARCHAR(100) | NOT NULL                                                  | title of the position                           |
| description    | TEXT         | NOT NULL                                                  | job description text extracted from the posting |
| applied_on     | DATE         |                                                           | date application was sent                       |
| created_at     | TIMESTAMP    | DEFAULT NOW()                                             | date/time job posting added to db               |
| updated_at     | TIMESTAMP    | DEFAULT NOW()                                             | date/time job posting last updated              |

Note: `description` holds the extracted text after the user has checked and corrected it, so the posting can be reviewed again after the page goes offline.

### resume
| Column             | Type         | Constraints                                               | Description                                  |
|--------------------|--------------|-----------------------------------------------------------|----------------------------------------------|
| resume_id          | SERIAL       | PRIMARY KEY                                               | unique resume id                             |
| account_id         | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                         |
| job_posting_id     | INTEGER      | REFERENCES job_posting(job_posting_id) ON DELETE CASCADE  | id of related job posting                    |
| name               | VARCHAR(100) | NOT NULL                                                  | label for this version                       |
| tone_set_id        | INTEGER      | REFERENCES tone_set(tone_set_id) ON DELETE SET NULL       | id of tone set used for this version         |
| headline           | VARCHAR(100) |                                                           | job title shown under the name in the header |
| based_on_resume_id | INTEGER      | REFERENCES resume(resume_id) ON DELETE SET NULL           | id of resume this version was copied from    |
| created_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time resume added to db                 |
| updated_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time resume last updated                |

Note: `job_posting_id` is empty for a base resume, an ongoing starting point not made for a specific posting. Seeded resumes are base resumes. For a tailored version the app suggests a default `name` (e.g. company and job title). For a base resume the user names it (e.g. "Tech base", "Teaching base").

Note: the header shows the account's name, contact details, and links, plus this resume's `headline`, the job title under the name. The user sets the headline per resume (e.g. to match the posting's job title). A copied resume keeps its headline until the user changes it.

Note: `based_on_resume_id` uses `ON DELETE SET NULL`, an exception to cascading deletes. Deleting an older version shouldn't delete every resume copied from it.

Note: `tone_set_id` picks the tone rules applied to this version. It's optional and uses `ON DELETE SET NULL`, so deleting a tone set never deletes a resume. A copied resume keeps its tone set until the user changes it.

Note: base resumes can be edited directly at any time, but the database keeps no history, so earlier states are lost. The app warns before editing a base resume and offers to create a new base resume based on it instead. Tailored versions are never edited to fit a different posting. Starting from any earlier resume copies all of its join rows (sections, items, sub-items) into a new resume, and the library items themselves are not copied.

### cover_letter
| Column             | Type         | Constraints                                               | Description                                     |
|--------------------|--------------|-----------------------------------------------------------|-------------------------------------------------|
| letter_id          | SERIAL       | PRIMARY KEY                                               | unique cover letter id                          |
| account_id         | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                            |
| job_posting_id     | INTEGER      | REFERENCES job_posting(job_posting_id) ON DELETE CASCADE  | id of related job posting                       |
| resume_id          | INTEGER      | REFERENCES resume(resume_id) ON DELETE CASCADE            | id of related resume                            |
| name               | VARCHAR(100) | NOT NULL                                                  | label for this version                          |
| tone_set_id        | INTEGER      | REFERENCES tone_set(tone_set_id) ON DELETE SET NULL       | id of tone set used for this version            |
| based_on_letter_id | INTEGER      | REFERENCES cover_letter(letter_id) ON DELETE SET NULL     | id of cover letter this version was copied from |
| addressee          | VARCHAR(100) |                                                           | who the greeting addresses: "Dear [addressee]," |
| created_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time cover letter added to db              |
| updated_at         | TIMESTAMP    | DEFAULT NOW()                                             | date/time cover letter last updated             |

Note: works the same way as `resume`. `based_on_letter_id` uses `ON DELETE SET NULL` for the same reason.

Note: `resume_id` links the cover letter to the resume it goes with. The cover letter's header matches that resume (the account's name, contact details, and links, plus the resume's `headline`). It can be empty for a base cover letter, which then shows the account details without a headline. When both are set, `job_posting_id` should match the resume's `job_posting_id`. Deleting the resume deletes its linked cover letters.

Note: `addressee` is everything after "Dear" in the greeting. It defaults to "[company] Hiring Team", using the job posting's `company` (or just "Hiring Team" when there's no posting). The user can replace it with anything, such as a hiring manager's name ("Ms. Rivera"). The app fills in the default, since a database default can't look up the company.

### section
| Column     | Type         | Constraints                                      | Description                                       |
|------------|--------------|--------------------------------------------------|---------------------------------------------------|
| id         | SERIAL       | PRIMARY KEY                                      | unique section id                                 |
| account_id | INTEGER      | REFERENCES account(account_id) ON DELETE CASCADE | id of owning account; empty for built-in sections |
| title      | VARCHAR(100) | NOT NULL                                         | heading of resume section or cover letter topic   |
| created_at | TIMESTAMP    | DEFAULT NOW()                                    | date/time section added to db                     |
| updated_at | TIMESTAMP    | DEFAULT NOW()                                    | date/time section last updated                    |

Note: sections are shared by resumes and cover letters. The `title` is only a name. The app never reads it to decide what a section holds; library items link to their section through `section_id` instead. Resume section titles are printed in the resume. Cover letter section titles are descriptors for the user only (e.g. "EdTech paragraph") and are never shown in the letter.

Note: five built-in sections are created with the database, with fixed ids: "Summary", "Skills", "Experience", "Projects", and "Education". They have no `account_id`, so every account shares them. They can't be deleted or renamed. Each resume or cover letter can use them or not.

Note: users can add any other sections they want (e.g. "Freelance and Consulting Experience", "Volunteer Experience", "Technical Skills", "EdTech paragraph").

Note: there are no content rules. Any kind of content (sentences, skill categories, experiences, projects, bullet points, education) can go in any section, including a mix of kinds in one section, and any section can be included in any resume. New skill categories, experiences, projects, and education entries default to the built-in "Skills", "Experience", "Projects", and "Education" sections as their home section, and the user can choose another.

Note: the backend refuses to delete or rename a built-in section, and a database trigger blocks it as a backstop.

### narrative_content
| Column     | Type         | Constraints                                               | Description                              |
|------------|--------------|-----------------------------------------------------------|------------------------------------------|
| content_id | SERIAL       | PRIMARY KEY                                               | unique narrative content id              |
| account_id | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                     |
| section_id | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                    |
| content    | TEXT         | NOT NULL                                                  | text of sentence(s)                      |
| created_at | TIMESTAMP    | DEFAULT NOW()                                             | date/time narrative content added to db  |
| updated_at | TIMESTAMP    | DEFAULT NOW()                                             | date/time narrative content last updated |

Note: each row is meant to hold one sentence, though nothing restricts it to one. Narrative sections, such as a resume summary or a cover letter paragraph, are built from sentences chosen and ordered by `position` in `resume_narrative_content` / `cover_letter_narrative_content`. No label column is needed, because the section groups the sentences.

Note: an accepted rewording is saved as a new row, and the original is never overwritten. Only the current resume or cover letter switches to the new sentence.

### skill_category
| Column        | Type         | Constraints                                               | Description                           |
|---------------|--------------|-----------------------------------------------------------|---------------------------------------|
| category_id   | SERIAL       | PRIMARY KEY                                               | unique skill category id              |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                  |
| section_id    | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                 |
| category_name | VARCHAR(100) | NOT NULL                                                  | name of skill category                |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill category added to db  |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill category last updated |

Note: `section_id` defaults to the built-in "Skills" section. The user can choose any other section.

### skill
| Column      | Type         | Constraints                                               | Description                  |
|-------------|--------------|-----------------------------------------------------------|------------------------------|
| skill_id    | SERIAL       | PRIMARY KEY                                               | unique skill id              |
| account_id  | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account         |
| category_id | INTEGER      | REFERENCES skill_category(category_id) ON DELETE CASCADE  | id of related skill category |
| skill_name  | VARCHAR(100) | NOT NULL                                                  | name of skill                |
| created_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill added to db  |
| updated_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time skill last updated |

Note: each skill belongs to one category. When a category is added to a resume, the app uses `category_id` to suggest which skills to include and in what order.

### experience
| Column        | Type         | Constraints                                               | Description                            |
|---------------|--------------|-----------------------------------------------------------|----------------------------------------|
| experience_id | SERIAL       | PRIMARY KEY                                               | unique experience id                   |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                   |
| section_id    | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                  |
| job_title     | VARCHAR(100) | NOT NULL                                                  | title of job held                      |
| company       | VARCHAR(100) | NOT NULL                                                  | name of employer                       |
| location      | VARCHAR(100) |                                                           | city/state and/or remote               |
| dates         | VARCHAR(50)  |                                                           | dates worked (e.g. Jan 2020 – Present) |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time experience added to db       |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time experience last updated      |

### project
| Column        | Type         | Constraints                                               | Description                                   |
|---------------|--------------|-----------------------------------------------------------|-----------------------------------------------|
| project_id    | SERIAL       | PRIMARY KEY                                               | unique project id                             |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                          |
| section_id    | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                         |
| project_title | VARCHAR(100) | NOT NULL                                                  | name of project                               |
| url           | TEXT         |                                                           | link to the project (repo, demo, or write-up) |
| dates         | VARCHAR(50)  |                                                           | dates worked as displayed (e.g. Spring 2024)  |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time project added to db                 |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time project last updated                |

### project_skill
| Column     | Type         | Constraints                                               | Description                       |
|------------|--------------|-----------------------------------------------------------|-----------------------------------|
| project_id | INTEGER      | NOT NULL REFERENCES project(project_id) ON DELETE CASCADE | id of related project             |
| skill_id   | INTEGER      | NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE     | id of related skill               |
| position   | INTEGER      | NOT NULL                                                  | default order of skill in project |

Primary key: (project_id, skill_id)

Note: the full list of skills used on a project, which the app suggests from. Which of these skills appear on a given resume is chosen per resume in `resume_project_skill`.

### bullet_point
| Column        | Type         | Constraints                                               | Description                             |
|---------------|--------------|-----------------------------------------------------------|-----------------------------------------|
| bullet_id     | SERIAL       | PRIMARY KEY                                               | unique bullet point id                  |
| account_id    | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                    |
| section_id    | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                   |
| experience_id | INTEGER      | REFERENCES experience(experience_id) ON DELETE CASCADE    | id of related experience as appropriate |
| project_id    | INTEGER      | REFERENCES project(project_id) ON DELETE CASCADE          | id of related project as appropriate    |
| content       | TEXT         | NOT NULL                                                  | text of bullet point                    |
| created_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time bullet point added to db      |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                                             | date/time bullet point last updated     |

Note: set `experience_id` or `project_id` to attach a bullet to a job or project. Leave both empty for a bullet that stands on its own in its section.

Note: an accepted rewording is saved as a new row with the same `section_id`, `experience_id`, and `project_id`, and the original is never overwritten. Only the current resume switches to the new bullet.

### education
| Column       | Type         | Constraints                                               | Description                                                              |
|--------------|--------------|-----------------------------------------------------------|--------------------------------------------------------------------------|
| education_id | SERIAL       | PRIMARY KEY                                               | unique education id                                                      |
| account_id   | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                                                     |
| section_id   | INTEGER      | NOT NULL REFERENCES section(id) ON DELETE CASCADE         | id of related section                                                    |
| degree       | VARCHAR(100) | NOT NULL                                                  | degree and field of study (e.g. B.A. in English)                         |
| institution  | VARCHAR(100) | NOT NULL                                                  | name of school or institution                                            |
| details      | VARCHAR(100) |                                                           | optional details about education                                         |
| graduation   | VARCHAR(100) |                                                           | graduation date and honors as displayed (e.g. May 2015, magna cum laude) |
| created_at   | TIMESTAMP    | DEFAULT NOW()                                             | date/time education added to db                                          |
| updated_at   | TIMESTAMP    | DEFAULT NOW()                                             | date/time education last updated                                         |

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

Note: the banned filler and AI-speak list from [WRITING_RULES.md](WRITING_RULES.md). Every rule applies to every resume and cover letter in the account. `kind` uses a Postgres enum type, `writing_rule_kind`, with the values `term` and `pattern`. A `term` (e.g. "leverage", "proven track record") is found by exact text match in code; a `pattern` (e.g. "lists of three used for rhythm") is a description Claude checks for. Exceptions for technical terms and proper nouns are Claude's judgment, as described in WRITING_RULES.md.

Note: each account is seeded with the starting list in WRITING_RULES.md. Setting `active` to false switches a rule off without deleting it.

### tone_set
| Column      | Type         | Constraints                                               | Description                                      |
|-------------|--------------|-----------------------------------------------------------|--------------------------------------------------|
| tone_set_id | SERIAL       | PRIMARY KEY                                               | unique tone set id                               |
| account_id  | INTEGER      | NOT NULL REFERENCES account(account_id) ON DELETE CASCADE | id of owning account                             |
| name        | VARCHAR(100) | NOT NULL                                                  | label for the tone set (e.g. "Tech", "Teaching") |
| created_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time tone set added to db                   |
| updated_at  | TIMESTAMP    | DEFAULT NOW()                                             | date/time tone set last updated                  |

Note: a named group of tone rules. Each resume and cover letter can use one tone set through `tone_set_id`.

### tone_rule
| Column       | Type         | Constraints                                                 | Description                                           |
|--------------|--------------|-------------------------------------------------------------|-------------------------------------------------------|
| tone_rule_id | SERIAL       | PRIMARY KEY                                                 | unique tone rule id                                   |
| tone_set_id  | INTEGER      | NOT NULL REFERENCES tone_set(tone_set_id) ON DELETE CASCADE | id of related tone set                                |
| rule_text    | TEXT         | NOT NULL                                                    | tone instruction (e.g. "Lead with tools and metrics") |
| position     | INTEGER      | NOT NULL                                                    | order of rule in the tone set                         |
| created_at   | TIMESTAMP    | DEFAULT NOW()                                               | date/time tone rule added to db                       |
| updated_at   | TIMESTAMP    | DEFAULT NOW()                                               | date/time tone rule last updated                      |

Note: deleting a tone set deletes its rules.

## Join Tables
A resume is built as a tree of the user's selections: resume → sections → items in each section → sub-items (skills in a category, skills in a project, bullets in an experience or project).
Each join row has its own id so the next level down can reference that specific selection, letting the same skill category show different skills on different resumes.

Conventions for every join table:
- `position` orders items under the same parent. Lower numbers appear first.
- A section can mix item types (e.g. a sentence, then two experiences). Items directly in the same section share one numbering across all join tables (`resume_narrative_content`, `resume_skill_category`, `resume_experience`, `resume_project`, `resume_bullet_point`, `resume_education`, and the cover letter equivalents), so the app can interleave them. The app assigns these numbers, since the database can't check positions across tables.
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

Note: the database doesn't check that `skill.category_id` matches the selected category. The app only suggests skills from the selected category, so a mismatched skill can't be added.

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

Note: lets each resume show a different set of skills for the same project, chosen to match the job. The app suggests skills from `project_skill` for that project.

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

Note: set `resume_experience_id` or `resume_project_id` when the bullet sits under an experience or project on this resume. Leave both empty for a bullet listed directly in the section. As with skills, the app should only offer bullets that belong to the selected experience or project, and parents from the same resume section.

### resume_education
| Column              | Type         | Constraints                                                             | Description                   |
|---------------------|--------------|-------------------------------------------------------------------------|-------------------------------|
| resume_education_id | SERIAL       | PRIMARY KEY                                                             | unique resume education id    |
| resume_section_id   | INTEGER      | NOT NULL REFERENCES resume_section(resume_section_id) ON DELETE CASCADE | id of related resume section  |
| education_id        | INTEGER      | NOT NULL REFERENCES education(education_id) ON DELETE CASCADE           | id of related education       |
| position            | INTEGER      | NOT NULL                                                                | order of education in section |

Unique: (resume_section_id, education_id)

**Cover letter join tables**

Cover letters follow the same pattern with only sections and narrative content: cover_letter → sections (paragraphs) → ordered sentences of narrative content.

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
