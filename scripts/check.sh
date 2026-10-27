#!/usr/bin/env bash
# Runs every automated check: backend lint, tests, and schema drift, then front end types,
# lint, and tests. Used by the git pre-commit hook (.githooks/pre-commit) and the /check
# skill. Run it from anywhere: scripts/check.sh
# Needs Postgres 18 running (brew services start postgresql@18) and Node on the PATH.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failures=""

run() {  # run <name> <folder> <command...>
    local name=$1 folder=$2
    shift 2
    printf '\n== %s\n' "$name"
    if ! (cd "$ROOT/$folder" && "$@"); then
        failures="$failures\n  - $name"
    fi
}

if ! "$(brew --prefix postgresql@18 2>/dev/null)/bin/pg_isready" -q -p 5433; then
    echo "Postgres 18 isn't running on port 5433. Start it with: brew services start postgresql@18"
    exit 1
fi
if ! command -v node >/dev/null; then
    echo "Node isn't on the PATH, so the front end checks can't run. Commit from a terminal" \
         "where 'node --version' works."
    exit 1
fi

run "ruff (backend lint)" backend .venv/bin/ruff check .
run "backend tests" backend .venv/bin/pytest -q
run "schema matches models (alembic check)" backend .venv/bin/alembic check
run "TypeScript" frontend node_modules/.bin/tsc -b
run "oxlint (front end lint)" frontend node_modules/.bin/oxlint
run "front end tests" frontend node_modules/.bin/vitest run

if [ -n "$failures" ]; then
    printf '\nFAILED:%b\n' "$failures"
    exit 1
fi
printf '\nAll checks passed.\n'
