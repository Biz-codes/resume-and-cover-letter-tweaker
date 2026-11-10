# Resume and Cover Letter Tweaker

[![Checks](https://github.com/Biz-codes/resume-and-cover-letter-tweaker/actions/workflows/checks.yml/badge.svg)](https://github.com/Biz-codes/resume-and-cover-letter-tweaker/actions/workflows/checks.yml)

A web app that tailors your resume and cover letter to each job posting, using content you've already written and suggestions from Claude, and saves every version so you never start over. Tailoring in an AI chat loses each version in an old conversation; here each new application builds on the best earlier one.

## Walkthrough
<!-- Video: replace this comment with the link to the recorded walkthrough (docs/WALKTHROUGH.md has the script). -->

<!-- Screenshots: uncomment once they're in docs/images/ (named in docs/WALKTHROUGH.md).
| Claude reads the posting | Reviewing Claude's draft |
| --- | --- |
| ![The new posting form, filled in by Claude from a pasted job description](docs/images/posting-read.png) | ![Claude's draft resume, each row badged Original, Library, or Claude, with its reason open](docs/images/draft-review.png) |
| **Keeping or discarding Claude's unused text** | **One bullet, reused across resumes** |
| ![The dialog listing Claude's text the draft didn't use, each with a checkbox to keep it](docs/images/approve-dialog.png) | ![A bullet's dialog, its "Used by" list showing the base resume and two tailored ones](docs/images/used-by.png) |
-->

The walkthrough uses made-up demo data (`db/seed_demo.sql`), never real applications.

## What stands out in how it's built
- **Claude's output is checked before it's shown.** Every Claude request uses structured outputs, so replies come back as typed data, and the backend checks every id in a suggestion is the user's own and listed where Claude put it before the draft reaches the screen. The library and earlier documents are sent first with prompt caching, so later requests reuse them.
- **The user approves every change.** Claude's draft shows each choice with its reason, badged as from the original, from the library, or Claude's wording, with the original a click away. Nothing reaches the document or the library until the user approves it.
- **Every version is saved and reused.** Each role, project, bullet, and sentence is stored once in a 47-table PostgreSQL library, and each resume only records which items it uses, in what order. Versions sent to employers are locked, so the record of what went out never changes.
- **Accessibility is tested in every state.** The front end targets WCAG 2.2 AA: axe-core runs after every test, each component has tests that reach every state it renders, lint rules and a contrast check run before the tests, and every change is announced to screen readers.
- **The docs are checked against the code.** Tests confirm the database doc matches the models, the models match the migrations, and the error codes doc matches the backend and front end. 700+ automated tests run in GitHub Actions on every push.

## Why
It can feel like you are writing an entirely new resume every time you apply for a different position. Then you have to go back into your files and try to remember a past application for a similar position from which you want to reuse phrasing. All of this searching and reinventing and keyword matching is a HUGE time suck you could instead be using to network, enhance your portfolio or build skills while job searching.

This app improves the process of what many job seekers already use AI chat for:
- tailoring resumes and cover letters to different job postings
- striking the balance between matching ATS keywords and impressing human hiring managers
- showing the skills and experience that are most relevant to each specific job

The goal of this app is to streamline the resume and cover letter writing process by being able to easily access saved content from previous resumes. On top of the app's organizational support, your AI job coach makes suggestions about how to best tailor your content to the job you want - from saved and/or new content. Each new application can build on the best work from earlier ones instead of starting over.

The app and AI do most of the heavy lifting. You keep final control over what goes into every resume and cover letter.

## Basics
Status: in progress. The content library, building resumes and cover letters, and tracking applications work. Claude reads job postings and the user's existing resumes and cover letters (PDF, Word, or pasted text) into the library, and drafts a tailored resume or cover letter for the user to review; chatting with Claude about the draft is being built now, and a public demo is planned.

Input: URL of a job posting (or none, when working on a base resume)
Output: plain text for a resume and cover letter tailored to that posting, ready to copy and paste

The app fetches the posting and has Claude extract its organization, role title, and description. The user's content lives in a Postgres library: every role, project, skill, bullet, and sentence is stored once, and each resume or cover letter only records which items it uses, in what order. The app builds a resume and cover letter from that library section by section, suggests which saved content fits the job best, and suggests improvements or new content. The user approves every choice. Base resumes, which aren't tied to any posting, are kept as ongoing starting points.

## Tech stack
- Python, FastAPI, PostgreSQL 18 (SQLAlchemy, Alembic)
- React with TypeScript (Vite)
- Claude API (Opus 5.5) through the `anthropic` SDK
- Vitest, axe-core, and pytest; GitHub Actions for CI

It runs locally for now. "Running it" in [Tech Stack](docs/TECH_STACK.md) has the commands, including `scripts/demo_db.sh`, which loads the demo data into its own database.

## Design docs
- [Build Plan](docs/BUILD_PLAN.md): the order the app is built in, and what's done so far
- [Tech Stack](docs/TECH_STACK.md): Python/FastAPI, Postgres, React/TypeScript, Claude, running locally
- [App Flow](docs/APP_FLOW.md): reading the job posting, the user flow, and how suggestions are made
- [Writing Rules](docs/WRITING_RULES.md): banned filler and AI-speak, and user-defined tone rules
- [Database](docs/DATABASE.md): library tables, join tables, and delete behavior
- [Front End Checks](docs/FRONTEND_CHECKS.md): rules the database doesn't enforce, which the app must handle
- [API Errors](docs/API_ERRORS.md): error codes and how failures are handled
- [Walkthrough](docs/WALKTHROUGH.md): the script for the recorded walkthrough, with the demo setup and the screenshots to take
