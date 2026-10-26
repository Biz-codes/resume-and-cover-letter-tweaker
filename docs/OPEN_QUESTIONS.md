# Open Questions

Decisions and gaps to resolve before coding starts. When one is answered, record the decision in the relevant doc and mark it decided here with a link.

## Decisions (highest priority)
1. ~~**Tech stack**~~: decided. See [TECH_STACK.md](TECH_STACK.md).
2. ~~**Single user?**~~: decided. One account for now, with `account` and `account_id` in place for multiple accounts later. See [DATABASE.md](DATABASE.md).
3. ~~**AI provider**~~: decided. Claude Opus 5.5 through the `anthropic` Python SDK. See [TECH_STACK.md](TECH_STACK.md).
4. ~~**Output format**~~: decided. Plain text to copy and paste. See [APP_FLOW.md](APP_FLOW.md).

## Missing data
5. ~~**Header information**~~: decided. Name, contact details, and links on `account`, plus a `headline` on each resume. See [DATABASE.md](DATABASE.md).
6. ~~**Cover letter details**~~: decided. No date, address, or closing fields. The header matches the linked resume through `cover_letter.resume_id`. See [DATABASE.md](DATABASE.md).
7. ~~**Thin tables**~~: decided.
   - ~~`project`~~: decided. Added optional `url` and `dates`. No description, since bullet points and skills cover it.
   - ~~`education`~~: decided. Added an optional `details` column. `degree` includes the field of study, and `graduation` includes any honors.
   - ~~`narrative_content`~~: decided. No label. Each row is usually one sentence, and sections group and order them.
8. ~~**Writing rules and tone rules**~~: decided. `writing_rule`, `tone_set`, and `tone_rule` tables, plus an optional `tone_set_id` on `resume` and `cover_letter`. See [DATABASE.md](DATABASE.md).

## Risks to plan for
9. ~~**Job site scraping**~~: decided. If fetching fails, the user pastes in the job description text. See [TECH_STACK.md](TECH_STACK.md).
10. ~~**Section titles**~~: decided. Titles are free-form names and never used for logic. Any content can go in any section; a library item's `section_id` is only its home section, used to rank suggestions. Five built-in sections can't be deleted or renamed. See [DATABASE.md](DATABASE.md).
11. ~~**Seed data format**~~: decided. Existing resumes (PDF or pasted text) are translated into a SQL seed file of `INSERT` statements, kept out of git. See [DATABASE.md](DATABASE.md).
