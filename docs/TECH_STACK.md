# Tech Stack

| Layer     | Choice                                             |
|-----------|----------------------------------------------------|
| Backend   | Python with FastAPI                                |
| Database  | PostgreSQL, run locally with Docker Compose        |
| ORM       | SQLAlchemy, with Alembic for migrations            |
| Front end | React with TypeScript, built with Vite             |
| AI        | Claude Opus 5.5 through the `anthropic` Python SDK |
| Hosting   | Runs locally on the user's machine                 |

## Why
- **FastAPI:** a lightweight API framework for a separate React front end. It handles slow calls (fetching job postings, AI requests) well and generates API docs automatically.
- **SQLAlchemy + Alembic:** the standard Python tools for working with Postgres and tracking schema changes as migrations. The schema in [DATABASE.md](DATABASE.md) maps to SQLAlchemy models.
- **TypeScript:** resumes are deeply nested (resume → sections → items → skills and bullets). Types catch mismatches between the front end and the API early.
- **Local:** no hosting cost, the user's resume data stays on their machine, and no login system is needed. It can be deployed later if that changes.

## AI integration
- **Direct API calls, not an agent.** The user flow is a fixed sequence, so the backend runs each step and makes one Claude request per step: extract the posting, suggest sections, suggest each section's content, suggest rewordings, review the whole thing.
- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), with effort set per step: lower for extracting a job posting, higher for rewording and the final review.
- **Structured responses:** each request defines the shape of the reply with a Pydantic model, so the app gets data it can use directly. For example, a skills suggestion comes back as an ordered list of `skill_id`s, each with a reason, ready to show for approval.
- **Streaming** for longer outputs (rewritten sections, the final review), so text appears as it's written.
- **Prompt caching:** the parts that stay the same across a session go first in every request and are cached: writing rules, library content, then the job posting. The step-specific request comes last.
- **Job posting extraction:** Python fetches the HTML, and Claude pulls out the job description, company, job title, and values as structured data. If fetching fails, the user pastes the text in instead.
- **Writing rules:** a code check finds banned words, and Claude judges only the flagged ones (technical term or filler?), per [WRITING_RULES.md](WRITING_RULES.md).

### API key and cost
- API usage is billed separately from a Claude.ai subscription, through an Anthropic Console account.
- The key lives in a `.env` file read only by the backend (`ANTHROPIC_API_KEY`), and `.env` is in `.gitignore`. The React front end never sees the key; all Claude calls go through FastAPI.
- Rough estimate: well under $1 per application with caching. Measure real usage once the app runs.
