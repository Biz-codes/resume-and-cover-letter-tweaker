#!/usr/bin/env bash
# Runs every automated check: backend lint, tests, and schema drift, then front end types,
# lint, and tests. Used by the git pre-commit hook (.githooks/pre-commit) and the /check
# skill, and by CI (.github/workflows/checks.yml). Run it from anywhere: scripts/check.sh
# Needs Postgres 18 running on port 5433 (brew services start postgresql@18), backend/.venv,
# frontend/node_modules, and Node (found on the PATH, or through nvm or Homebrew).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# A shell that didn't load the user's profile (an editor's commit box, an agent's shell) may
# not have Homebrew or nvm on its PATH, so look in their usual places too.
for prefix in /opt/homebrew /usr/local; do
    if [ -x "$prefix/bin/brew" ] && ! command -v brew >/dev/null; then
        PATH="$prefix/bin:$PATH"
    fi
done
if ! command -v node >/dev/null; then
    want="$(cat "$ROOT/.nvmrc" 2>/dev/null)"
    nvm_dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
    # The newest installed Node with the major version in .nvmrc.
    node_bin="$(ls -d "$nvm_dir"/v"${want:-}"* 2>/dev/null | sort -V | tail -n 1)/bin"
    if [ -n "$want" ] && [ -x "$node_bin/node" ]; then
        PATH="$node_bin:$PATH"
    fi
fi
export PATH
failures=""

run() {  # run <name> <folder> <command...>
    local name=$1 folder=$2
    shift 2
    printf '\n== %s\n' "$name"
    if ! (cd "$ROOT/$folder" && "$@"); then
        failures="$failures\n  - $name"
    fi
}

# Homebrew's Postgres tools aren't on the PATH; on a machine without Homebrew (CI), they are.
pg_isready=pg_isready
if command -v brew >/dev/null; then
    pg_isready="$(brew --prefix postgresql@18)/bin/pg_isready"
fi
if ! "$pg_isready" -q -p 5433; then
    echo "Postgres 18 isn't running on port 5433. Start it with: brew services start postgresql@18"
    exit 1
fi
if ! command -v node >/dev/null; then
    echo "Node isn't on the PATH or in nvm (version from .nvmrc), so the front end" \
         "checks can't run. Install it, or commit from a terminal where 'node --version' works."
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
