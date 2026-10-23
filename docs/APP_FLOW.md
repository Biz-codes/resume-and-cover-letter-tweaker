# App Flow

How the app turns a job posting url into a tailored resume and cover letter, and how base resumes are kept. Every suggestion follows [WRITING_RULES.md](WRITING_RULES.md). Content comes from the database described in [DATABASE.md](DATABASE.md).

## Reading the job posting
1. Fetch the HTML from the url.
2. Find the part of the page that holds the job description. Ignore navigation, ads, and unrelated listings.
3. Pull out its text, including any description of the company, its mission, and its values. Those are used for the cover letter and for tone.
4. Show the extracted text to the user so they can fix anything that was missed or picked up by mistake.

## User flow
1. **Enter the url.** The app extracts the job description as described above and saves it as a `job_posting` with the company and job title.
2. **Choose a starting point.** The app suggests base resumes and earlier tailored resumes that fit the posting. The user can start from a copy of one of them, which keeps its sections and selections ready to adjust, or start fresh. Either way the result is saved as a new version linked to this posting, and the original is not changed.
3. **Choose sections.** The app suggests which sections to include and in what order. Usually that's all of them, but it may leave some out, such as freelance experience or projects, when they don't fit the job. The user can add, remove, or reorder sections.
4. **Build each section.** Starting with the first selected section (usually the summary), the app suggests the content that belongs in that section:
   - **Summary / narrative content:** which existing text to use
   - **Skills:** which skill categories and skills to include, and their order
   - **Experience:** which jobs to include and which bullet points for each
   - **Projects:** which projects to include, which of their skills to show, and which bullet points to use
   - **Education:** which entries to include

   For each suggestion the user can:
   - accept it
   - review alternate existing bullet points for the same job or project and pick different ones
   - ask the app for further tweaks
   - make their own edits or describe their own ideas for the app to work from

   The app moves to the next section once the user is happy with the current one, until every selected section is built.
5. **Build the cover letter.** It follows the same steps: choose a starting point, choose sections, then choose and adjust the narrative content for each one.
6. **Review the whole thing.** The app reviews the finished resume and cover letter together. It checks how well they cover the job's keywords, and looks for repeated wording, inconsistencies, and anything that breaks the writing rules.
7. **Output** the final text. The user can record the date they applied on the job posting.

## Base resumes
Base resumes and cover letters aren't tied to a job posting. They're ongoing starting points the user keeps coming back to, such as a general tech resume or a teaching resume. The seeded data starts out as base resumes.
- The user can create, edit, and improve a base resume at any time, without a url. The same section-by-section building, suggestions, and writing rules apply, just without a posting to match against.
- Edits to a base resume change it directly. They don't create a new version, and the earlier state can't be recovered. Before editing, the app warns the user and offers to create a new base resume based on this one, so the original stays available.
- A tailored version that turned out well can be copied into a new base resume.

## Suggestions
Suggestions are based on:
- **Keyword matching:** skills, tools, qualifications, and values named in the posting, compared against the content in the database.
- **AI judgment:** the same kind of review an AI does when asked in chat to tailor a resume. That includes relevance to the role, strength of results and impact, mirroring the posting's language where it's accurate, and order (strongest match first).

Beyond choosing existing content, the app also suggests improvements, such as rewording a bullet point, reordering skills, or rephrasing part of the cover letter. When the user accepts a reworded or new bullet point, it's saved as a new `bullet_point` row linked to the same section, experience, or project, so it can be reused later. The original bullet stays in the library.
