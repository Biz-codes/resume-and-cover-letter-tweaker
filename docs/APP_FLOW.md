# App Flow

How the app turns a job posting url into a tailored resume and cover letter, and how base resumes are kept. Every suggestion follows [WRITING_RULES.md](WRITING_RULES.md). Content comes from the database described in [DATABASE.md](DATABASE.md).

## Modes
The app has distinct modes, so it's always clear whether the user is managing their content or building a document. Home asks "What do you want to do?" and offers one choice per mode; the main nav lists them too (`frontend/src/modes.ts`).
- **Library** (`/library`): view and edit everything a resume or cover letter can draw from (headers, sections, skills, experience, projects, bullet points, and the rest), with its own sub-nav.
- **Job postings** (`/postings`), **Resumes** (`/resumes`), and **Cover letters** (`/cover-letters`): create and work on them, following the user flow below. Job postings shows a "coming soon" page until it's built. A resume or cover letter has its own page (`/resumes/:id`, `/cover-letters/:id`) where it's built in place, with no separate details form:
  - Its name, with Rename, Make a copy, Done editing (while editing a base version in place), and Delete.
  - Its tone, at the top.
  - A tree of nested lists whose levels open and close (the disclosure pattern), all starting closed, so the user can work on one part at a time with everything on one page:
    - **Header:** one dropdown per value (name, headline, email, phone, location, LinkedIn, GitHub, portfolio), each offering every value saved in any header, a new value typed in, or none (except the name). Each change points the document at the saved header with exactly those values, or a new one.
    - **Sections:** add, remove, and reorder them. Each section opens to its items (any mix of kinds, in one order). A role, project, or education entry opens to its fields; a category or project to its skills; and a role or project to its bullets.
    - **Defaults, then More options:** every level starts filled with defaults, which AI suggestions will replace in phase 5: a new resume or cover letter gets default sections, an added section its default items, and an added role, project, or category its default bullets and skills (see "Defaults" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)). Under each list, a "More options" level (closed to start) offers the rest of what the library lists there as checkboxes: a section's items (grouped by type), a role's or project's bullets, a category's or project's skills, and for the sections list, every section. The user checks any number and clicks Add; they go last, and a section's items come with their own defaults. When everything listed there is already shown, it says "No more options" in the same place. Remove, reorder, New version, New bullet (under a role or project), and New skill (under a category or project) work alongside it.
    - **Adding other content to a section** is type first: pick the type (role, project, skill category, education, bullet, or narrative content), then a saved item of that type (the ones the section lists first), or "New …" to fill in that type's fields, which saves it to the library under the section. A saved item comes with its defaults. The type starts as the kind the library lists most under the section, never decided from its title; a section that lists nothing asks for the type. An empty section shows this form right away.
    - **New version** of a bullet (under a role or project, or placed directly in a section) or of narrative content: a form under it that starts from its text. Changed text saves a new library item, listed right after the original wherever the original is listed, and it takes the original's place in this document only. The original stays in the library and in other documents. Unchanged text saves nothing.
    - **Greeting** and **Sign-off** (cover letters only).
  - **Preview and copy:** the plain-text output, with copy buttons.

  Changes save as they're made: a choice from a dropdown right away, and typed text (a new header value, the greeting, the name under the sign-off) when the user leaves the field or presses Enter. Checked options save with Add, and forms that start something new (adding content to a section, a new bullet or skill, a new version, renaming) save with their own button.

  A sent version shows the tree read-only and can only be renamed. A base version is shown read-only until the user chooses to edit it in place or make a copy (see "Warn before editing" in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md)); "Done editing", next to Rename and Make a copy, shows it read-only again.

Building a resume or cover letter never requires switching to the library: content written there (a new or reworded bullet, new narrative content) is saved to the library as part of the flow.

## Reading the job posting
1. Fetch the HTML from the url.
2. Find the part of the page that holds the job description. Ignore navigation, ads, and unrelated listings.
3. Pull out its text, including any description of the organization, its mission, and its values. Those are used for the cover letter and for tone.
4. Show the extracted text to the user so they can fix anything that was missed or picked up by mistake.

If the page can't be fetched (many job sites block automated requests) or no job description is found, the app shows a box for pasting in the job description instead (`POSTING_FETCH_FAILED`, see [API_ERRORS.md](API_ERRORS.md)). If a Claude request fails at any step, the user's work so far is kept and they can retry (`AI_UNAVAILABLE`).

## User flow
Everything for an application hangs off its job posting. A resume and a cover letter aren't linked to each other directly; both belong to the posting and share its header.

1. **Create the job posting.** The user enters the url. The app extracts the job description as described above and saves it as a `job_posting` with the organization and role title.
2. **Choose the posting's header.** The app suggests a header: the user's name and contact details from their most recent header, with a headline (the role title shown under their name) based on the posting. The user accepts it, edits it, or picks another saved header. A changed headline or contact detail is saved as a new header, so earlier resumes and cover letters keep theirs. The choice is saved as the posting's header.
3. **Start a resume or cover letter for the posting.** Either can come first. Each starts with the posting's header, and the user is asked to use it, edit it, or pick another saved header. The app suggests starting points that fit the posting: base versions and earlier tailored ones. The user can start from a copy of one of them, which keeps its sections and selections ready to adjust, or start fresh, and choose a tone, if any. Either way the result is saved as a new version linked to this posting, and the original is not changed.
4. **Choose sections.** Steps 4 and 5 work in whatever order the user likes (see "Working in any order" below). The app suggests which sections to include and in what order. Usually that's all of them, but it may leave some out, such as freelance experience or projects, when they don't fit the job. The user can add, remove, or reorder sections.
5. **Build each section.** For whichever section the user is working on, the app suggests the content that belongs in it:
   - **Summary / narrative content:** which existing narrative content (sentences or whole paragraphs) to use, and in what order
   - **Skills:** which skill categories and skills to include, and their order
   - **Experience:** which roles to include and which bullet points for each, chosen from all the bullets listed under that role: the ones that best fit the posting, leaving out near-duplicates of each other
   - **Projects:** which projects to include, which of their skills to show, and which bullet points to use, chosen the same way
   - **Education:** which entries to include

   For each suggestion the user can:
   - accept it
   - swap a bullet for another one listed under the same role or project
   - ask for a variation of a bullet, or write a new one; either is saved as a new bullet listed under that role or project
   - ask the app for further tweaks
   - make their own edits or describe their own ideas for the app to work from

   When the user moves on to another section, the app suggests content for it the same way.

   **Working in any order.** The user decides how to build the resume, and can switch approaches at any time:
   - lay out all the sections first, then go back and fill each one
   - go section by section from the start, choosing content as each section is added
   - add sections in any order, reorder them, and remove them at any point

   Nothing is final until the user is done: any section's content, the section order, the header, and the tone can all be changed until then. The cover letter works the same way. Once the user records the date they applied, the posting's resume and cover letter are locked as a record of what was sent; later changes go in a copy.
6. **Build the cover letter.** It follows the same steps under the same posting: header, starting point, sections, then choose, order, and adjust each section's content (usually narrative content, but any kind of content the user wants). Each paragraph is a section. When the user writes a new paragraph, the app suggests a short title from its content (e.g. "intro", "key technical demands"), reusing an existing section when the paragraph plays the same role. The user can change it. Titles are never printed in the letter. The app sets the greeting ("Dear [organization] Hiring Team,") and the sign-off ("Sincerely," and the user's name), and the user can change either.
7. **Review the whole thing.** The app reviews the posting's finished resume and cover letter together. It checks how well they cover the job's keywords, and looks for repeated wording, inconsistencies, and anything that breaks the writing rules.
8. **Output** the final resume and cover letter as plain text for the user to copy and paste into their own document or an application form. There are copy buttons for the whole document and for each section. No .docx or PDF export.

   Plain-text layout:
   - **Header:** name, then the headline, then contact details and links on one line separated by ` | ` (email, phone, location, then the LinkedIn, GitHub, and portfolio links).
   - **Resume sections:** the section title, then its content, with a blank line between sections.
   - **Narrative content:** excerpts placed one after another run together as one paragraph.
   - **Skills:** one line per category, like `Category: skill, skill, skill`.
   - **Experience:** `Role Title | Organization | Location | Dates`, then its bullets.
   - **Projects:** `Project Title | Done For | Dates`, then a `Skills: skill, skill` line and its bullets.
   - **Education:** `Degree | Institution | Graduation`, then its details.
   - Empty parts of a line (nothing in `done_for`, no dates) are left out.
   - **Bullets:** each starts with `- `.
   - **Cover letter:** header, greeting, paragraphs separated by blank lines (no section titles), then the sign-off and the user's name (the letter's `signature_name`, or the header's `full_name` when that's empty). No greeting without an addressee, and no closing without a sign-off.

   The backend builds the text (`backend/app/plain_text.py`) in parts: the header, each section, and a letter's greeting and sign-off, so each part has its own copy button.
9. **Track the application.** On the job posting, the user can record the date they applied (which locks its resume and cover letter), the date they were turned down or hired, and contacts such as the hiring manager or a referral. They can add interviews (date and notes), and link one interview to several of the organization's postings when it covered more than one opening.

## Base resumes
Base resumes and cover letters aren't tied to a job posting. They're ongoing starting points the user keeps coming back to, such as a general tech resume or a teaching resume. The seeded data starts out as base resumes.
- The user can create, edit, and improve a base resume at any time, without a url. The same section-by-section building, suggestions, and writing rules apply, just without a posting to match against.
- Edits to a base resume change it directly. They don't create a new version, and the earlier state can't be recovered. Before editing, the app warns the user and offers to create a new base resume based on this one, so the original stays available.
- A tailored version that turned out well can be copied into a new base resume.

## Suggestions
Suggestions are based on:
- **Keyword matching:** skills, tools, qualifications, and values named in the posting, compared against the content in the database.
- **AI judgment:** the same kind of review an AI does when asked in chat to tailor a resume. That includes relevance to the role, strength of results and impact, mirroring the posting's language where it's accurate, and order (strongest match first).

Beyond choosing existing content, the app also suggests improvements, such as rewording a bullet point, reordering skills, or rephrasing part of the cover letter. When the user accepts a reworded or new bullet point, it's saved as a new `bullet_point` row linked to the same section, experience, or project. Accepted reworded or new narrative content (in a summary or cover letter) is saved the same way, as a new `narrative_content` row linked to the same section. Either way the new row can be reused later, takes the original's place in the current resume or cover letter, and the original stays in the library.
