"""App settings, read from environment variables and backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str
    # Only the tests use this database.
    test_database_url: str | None = None
    # Not needed until phase 5 (job postings and AI).
    anthropic_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
