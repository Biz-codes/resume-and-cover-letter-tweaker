# App Flow

How the app turns a job posting url into a tailored resume and cover letter, and how base resumes are kept. Every suggestion follows [WRITING_RULES.md](WRITING_RULES.md). Content comes from the database described in [DATABASE.md](DATABASE.md).

## Reading the job posting
1. Fetch the HTML from the url.
2. Find the part of the page that holds the job description. Ignore navigation, ads, and unrelated listings.
3. Pull out its text, including any description of the company, its mission, and its values. Those are used for the cover letter and for tone.
4. Show the extracted text to the user so they can fix anything that was missed or picked up by mistake.

If the page can't be fetched (many job sites block automated requests) or no job description is found, the app shows a box for pasting in the job description instead (`POSTING_FETCH_FAILED`, see [API_ERRORS.md](API_ERRORS.md)). If a Claude request fails at any step, the user's work so far is kept and they can retry (`AI_UNAVAILABLE`).

## User flow
Everything for an application hangs off its job posting. A resume and a cover letter aren't linked to each other directly; both belong to the posting and share its header.

1. **Create the job posting.** The user enters the url. The app extracts the job description as described above and saves it as a `job_posting` with the company and job title.
2. **Choose the posting's header.** The app suggests a header: the user's name and contact details from their most recent header, with a headline (the job title shown under their name) based on the posting. The user accepts it, edits it, or picks another saved header. A changed headline or contact detail is saved as a new header, so earlier resumes and cover letters keep theirs. The choice is saved as the posting's header.
3. **Start a resume or cover letter for the posting.** Either can come first. Each starts with the posting's header, and the user is asked to use it, edit it, or pick another saved header. The app suggests starting points that fit the posting: base versions and earlier tailored ones. The user can start from a copy of one of them, which keeps its sections and selections ready to adjust, or start fresh, and choose a tone set, if any. Either way the result is saved as a new version linked to this posting, and the original is not changed.
4. **Choose sections.** Steps 4 and 5 work in whatever order the user likes (see "Working in any order" below). The app suggests which sections to include and in what order. Usually that's all of them, but it may leave some out, such as freelance experience or projects, when they don't fit the job. The user can add, remove, or reorder sections.
5. **Build each section.** For whichever section the user is working on, the app suggests the content that belongs in it:
   - **Summary / narrative content:** which existing sentences to use, and in what order
   - **Skills:** which skill categories and skills to include, and their order
   - **Experience:** which jobs to include and which bullet points for each, chosen from all the bullets listed under that job: the ones that best fit the posting, leaving out near-duplicates of each other
   - **Projects:** which projects to include, which of their skills to show, and which bullet points to use, chosen the same way
   - **Education:** which entries to include

   For each suggestion the user can:
   - accept it
   - swap a bullet for another one listed under the same job or project
   - ask for a variation of a bullet, or write a new one; either is saved as a new bullet listed under that job or project
   - ask the app for further tweaks
   - make their own edits or describe their own ideas for the app to work from

   When the user moves on to another section, the app suggests content for it the same way.

   **Working in any order.** The user decides how to build the resume, and can switch approaches at any time:
   - lay out all the sections first, then go back and fill each one
   - go section by section from the start, choosing content as each section is added
   - add sections in any order, reorder them, and remove them at any point

   Nothing is final until the user is done: any section's content, the section order, the header, and the tone set can all be changed until then. The cover letter works the same way. Once the user records the date they applied, the posting's resume and cover letter are locked as a record of what was sent; later changes go in a copy.
6. **Build the cover letter.** It follows the same steps under the same posting: header, starting point, sections, then choose, order, and adjust each section's content (usually sentences, but any kind of content the user wants). Each paragraph is a section. When the user writes a new paragraph, the app suggests a short title from its content (e.g. "intro", "key technical demands"), reusing an existing section when the paragraph plays the same role. The user can change it. Titles are never printed in the letter. The app sets the greeting ("Dear [company] Hiring Team,") and the sign-off ("Sincerely," and the user's name), and the user can change either.
7. **Review the whole thing.** The app reviews the posting's finished resume and cover letter together. It checks how well they cover the job's keywords, and looks for repeated wording, inconsistencies, and anything that breaks the writing rules.
8. **Output** the final resume and cover letter as plain text for the user to copy and paste into their own document or an application form. There are copy buttons for the whole document and for each section. No .docx or PDF export.

   Plain-text layout:
   - **Header:** name, then the headline, then contact details and links on one line separated by ` | `.
   - **Resume sections:** the section title, then its content.
   - **Skills:** one line per category, like `Category: skill, skill, skill`.
   - **Experience:** `Job Title | Company | Location | Dates`, then its bullets.
   - **Projects:** `Project Title | Done For | Dates`, then its skills and bullets; empty parts (nothing in `done_for`, no dates) are left out. Education follows the same pattern as experience.
   - **Bullets:** each starts with `- `.
   - **Cover letter:** header, greeting, paragraphs separated by blank lines (no section titles), then the sign-off and the user's name (the letter's `signature_name`, or the header's `full_name` when that's empty). On the job posting, the user can record the date they applied, the date they were turned down or hired, and contacts such as the hiring manager or a referral. They can add interviews (date and notes), and link one interview to several of the company's postings when it covered more than one opening.

## Base resumes
Base resumes and cover letters aren't tied to a job posting. They're ongoing starting points the user keeps coming back to, such as a general tech resume or a teaching resume. The seeded data starts out as base resumes.
- The user can create, edit, and improve a base resume at any time, without a url. The same section-by-section building, suggestions, and writing rules apply, just without a posting to match against.
- Edits to a base resume change it directly. They don't create a new version, and the earlier state can't be recovered. Before editing, the app warns the user and offers to create a new base resume based on this one, so the original stays available.
- A tailored version that turned out well can be copied into a new base resume.

## Suggestions
Suggestions are based on:
- **Keyword matching:** skills, tools, qualifications, and values named in the posting, compared against the content in the database.
- **AI judgment:** the same kind of review an AI does when asked in chat to tailor a resume. That includes relevance to the role, strength of results and impact, mirroring the posting's language where it's accurate, and order (strongest match first).

Beyond choosing existing content, the app also suggests improvements, such as rewording a bullet point, reordering skills, or rephrasing part of the cover letter. When the user accepts a reworded or new bullet point, it's saved as a new `bullet_point` row linked to the same section, experience, or project. An accepted reworded or new sentence (in a summary or cover letter) is saved the same way, as a new `narrative_content` row linked to the same section. Either way the new row can be reused later, takes the original's place in the current resume or cover letter, and the original stays in the library.
