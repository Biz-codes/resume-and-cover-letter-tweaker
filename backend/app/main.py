"""FastAPI app. Run from backend/ with: .venv/bin/uvicorn app.main:app --reload"""

from fastapi import FastAPI
from sqlalchemy import text

from app.db import DbSession
from app.errors import register_error_handlers

app = FastAPI(title="Resume and Cover Letter Tweaker")
register_error_handlers(app)


@app.get("/api/health")
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
