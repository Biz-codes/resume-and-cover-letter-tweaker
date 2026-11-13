"""FastAPI app. Run from backend/ with: .venv/bin/uvicorn app.main:app --reload"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from sqlalchemy import text

from app.config import BACKEND_DIR, get_settings
from app.db import DbSession
from app.errors import register_error_handlers
from app.routers import (
    bullet_points,
    cover_letters,
    education,
    experience,
    headers,
    interviews,
    job_postings,
    narrative_content,
    projects,
    resumes,
    sections,
    sign_offs,
    skill_categories,
    skills,
    tone_sets,
    writing_rules,
)


def log_to_file(path: str) -> None:
    """The app's log (its errors with their causes, and each Claude request's usage) in a file
    as well as the terminal, so it can be read after the fact. Kept to four files of 1 MB.
    It can hold bits of the user's text, so it's gitignored and the pre-commit hook refuses it."""
    if not path:
        return
    file = BACKEND_DIR / path
    file.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(file, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger = logging.getLogger("app")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    # Still shown in the terminal, as before (warnings and errors).
    terminal = logging.StreamHandler()
    terminal.setLevel(logging.WARNING)
    terminal.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    logger.addHandler(terminal)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Only when the app is served: the tests never start its lifespan, so they write no log.
    log_to_file(get_settings().log_file)
    yield


app = FastAPI(title="Resume and Cover Letter Tweaker", lifespan=lifespan)
register_error_handlers(app)
for module in (headers, sections, skill_categories, skills, experience, projects,
               bullet_points, education, narrative_content, writing_rules, tone_sets, sign_offs,
               resumes, cover_letters, job_postings, interviews):
    app.include_router(module.router)


@app.get("/api/health")
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
