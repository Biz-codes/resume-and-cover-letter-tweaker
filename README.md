# Resume and Cover Letter Tweaker

## Why
This app does what I already use AI chat for: tailoring a resume and cover letter to each job posting. A dedicated app saves every version I make along the way. Each new application can build on the best work from earlier ones instead of starting over.

The app and AI do most of the heavy lifting. I keep final control over what goes into every resume and cover letter.

## Basics
Input: url of a job posting (or none, when working on a base resume)
Output: plain text for a resume and cover letter tailored to that posting, ready to copy and paste

The app reads a job posting, then helps the user build a resume and cover letter from content they've already written (stored in the database). It works section by section, suggests which existing content fits the job best, and suggests improvements. The user approves every choice. Base resumes, which aren't tied to any posting, are kept as ongoing starting points.

## Docs
- [Tech Stack](docs/TECH_STACK.md): Python/FastAPI, Postgres, React/TypeScript, Claude, running locally
- [App Flow](docs/APP_FLOW.md): reading the job posting, the user flow, and how suggestions are made
- [Writing Rules](docs/WRITING_RULES.md): banned filler and AI-speak, and user-defined tone rules
- [Database](docs/DATABASE.md): library tables, join tables, and delete behavior
- [Front End Checks](docs/FRONTEND_CHECKS.md): rules the database doesn't enforce, which the app must handle
- [API Errors](docs/API_ERRORS.md): error codes and how failures are handled
