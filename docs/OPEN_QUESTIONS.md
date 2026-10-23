# Open Questions

Decisions and gaps to resolve before coding starts. When one is answered, record the decision in the relevant doc and remove it from this list.

## Decisions (highest priority)
1. **Tech stack:** the language and framework for the backend and the user interface. Postgres is already assumed (`SERIAL`, `NOW()`). Web app running locally, hosted site, or desktop app?
2. **Single user?** The database has no users or accounts. That's fine if the app is only for its owner, but it's hard to add later.
3. **AI provider:** which model and API to use, and how the API key is provided.
4. **Output format:** plain text to copy and paste, or exported .docx or PDF files with a layout? Exported files need templates and formatting rules.

## Missing data
5. **Header information:** there's nowhere to store name, email, phone, LinkedIn, or portfolio links. Every resume and cover letter needs these.
6. **Cover letter details:** the date, the company's address, and the closing aren't modeled. They could belong on the cover letter or be filled in from the job posting.
7. **Thin tables:**
   - `project` has only a title. Probably needs a description, a link, and dates.
   - `education` has no field of study or dates attended.
   - `narrative_content` has no label, so different summaries would be hard to tell apart in a list.
8. **Writing rules and tone rules:** [WRITING_RULES.md](WRITING_RULES.md) says these need storage, but the tables aren't designed yet.

## Risks to plan for
9. **Job site scraping:** many sites (LinkedIn, Workday, Indeed) load content with JavaScript or block automated requests, so fetching the url won't always work. Plan a fallback where the user pastes in the job description text.
10. **Section titles:** the app decides what a section holds from its free-text `title`. A `section_type` column (summary, skills, experience, projects, education, cover letter paragraph) would be more reliable, and titles could change without breaking anything.
11. **Seed data format:** what form is the existing resume data in (.docx, PDF, text)? That decides whether to build an import step or enter it by hand.
