#!/usr/bin/env bash
# Builds the demo database (resume_tweaker_demo): the schema from the migrations, then the
# made-up data in db/seed_demo.sql. Screenshots and recordings use it, so they never show the
# user's real applications. Run it from anywhere:
#   scripts/demo_db.sh          builds it (stops if it already exists)
#   scripts/demo_db.sh --reset  deletes the demo database first, then builds it again
# Then start the API against it, from backend/:
#   DATABASE_URL=postgresql+psycopg://localhost:5433/resume_tweaker_demo .venv/bin/uvicorn app.main:app --reload
# Needs Postgres 18 running on port 5433 and backend/.venv.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=resume_tweaker_demo

# Homebrew's Postgres tools aren't on the PATH; on a machine without Homebrew, they are.
pg_bin=""
if command -v brew >/dev/null; then
    pg_bin="$(brew --prefix postgresql@18)/bin/"
fi
if ! "${pg_bin}pg_isready" -q -p 5433; then
    echo "Postgres 18 isn't running on port 5433. Start it with: brew services start postgresql@18"
    exit 1
fi

exists=$("${pg_bin}psql" -p 5433 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'")
if [ -n "$exists" ]; then
    if [ "${1:-}" != "--reset" ]; then
        echo "$DB already exists. Run with --reset to delete it and build it again."
        exit 1
    fi
    "${pg_bin}dropdb" -p 5433 "$DB"
fi

"${pg_bin}createdb" -p 5433 "$DB"
(cd "$ROOT/backend" && DATABASE_URL="postgresql+psycopg://localhost:5433/$DB" \
    .venv/bin/alembic upgrade head)
"${pg_bin}psql" -p 5433 -d "$DB" -1 -q -v ON_ERROR_STOP=1 -f "$ROOT/db/seed_demo.sql"

echo "Built $DB. Start the API against it, from backend/:"
echo "  DATABASE_URL=postgresql+psycopg://localhost:5433/$DB .venv/bin/uvicorn app.main:app --reload"
