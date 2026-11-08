# Resume and Cover Letter Tweaker

[![Checks](https://github.com/Biz-codes/resume-and-cover-letter-tweaker/actions/workflows/checks.yml/badge.svg)](https://github.com/Biz-codes/resume-and-cover-letter-tweaker/actions/workflows/checks.yml)

A web app that tailors your resume and cover letter to each job posting, using content you've already written and suggestions from Claude, and saves every version so you never start over.

## Why
It can feel like you are writing an entirely new resume every time you apply for a different position. Then you have to go back into your files and try to remember a past application for a similar position from which you want to reuse phrasing. All of this searching and reinventing and keyword matching is a HUGE time suck you could instead be using to network, enhance your portfolio or build skills while job searching.

This app improves the process of what many job seekers already use AI chat for:
- tailoring resumes and cover letters to different job postings
- striking the balance between matching ATS keywords and impressing human hiring managers
- showing the skills and experience that are most relevant to each specific job

The goal of this app is to streamline the resume and cover letter writing process by being able to easily access saved content from previous resumes. On top of the app's organizational support, your AI job coach makes suggestions about how to best tailor your content to the job you want - from saved and/or new content. Each new application can build on the best work from earlier ones instead of starting over.

The app and AI do most of the heavy lifting. You keep final control over what goes into every resume and cover letter.

## Basics
Status: in progress. The content library, building resumes and cover letters, and tracking applications work. Claude reads job postings and drafts a tailored resume or cover letter for the user to review; chatting with Claude about the draft is being built now, and a public demo is planned.

Input: URL of a job posting (or none, when working on a base resume)
Output: plain text for a resume and cover letter tailored to that posting, ready to copy and paste

The app fetches the posting and has Claude extract its organization, role title, and description. The user's content lives in a Postgres library: every role, project, skill, bullet, and sentence is stored once, and each resume or cover letter only records which items it uses, in what order. The app builds a resume and cover letter from that library section by section, suggests which saved content fits the job best, and suggests improvements or new content. The user approves every choice. Base resumes, which aren't tied to any posting, are kept as ongoing starting points.

## How it's built
- Python, FastAPI, PostgreSQL (SQLAlchemy, Alembic), and React with TypeScript
- Claude API (Opus 5.5) with structured outputs, so AI suggestions come back as data the app checks before showing them
- A content library where every role, project, bullet, and sentence is stored once and reused across resumes; versions sent to employers are locked, so the record of what went out never changes, and editing an item asks which resumes in progress get the change
- Accessible to WCAG 2.2 AA: automated accessibility checks in every front end test, full keyboard support, and screen reader announcements for every change
- 600+ automated tests, including checks that the docs, models, and migrations agree

## Design docs
- [Build Plan](docs/BUILD_PLAN.md): the order the app is built in, and what's done so far
- [Tech Stack](docs/TECH_STACK.md): Python/FastAPI, Postgres, React/TypeScript, Claude, running locally
- [App Flow](docs/APP_FLOW.md): reading the job posting, the user flow, and how suggestions are made
- [Writing Rules](docs/WRITING_RULES.md): banned filler and AI-speak, and user-defined tone rules
- [Database](docs/DATABASE.md): library tables, join tables, and delete behavior
- [Front End Checks](docs/FRONTEND_CHECKS.md): rules the database doesn't enforce, which the app must handle
- [API Errors](docs/API_ERRORS.md): error codes and how failures are handled
