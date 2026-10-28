#!/usr/bin/env python3
"""PostToolUse hook: lint or type-check a file right after Claude edits it.

- .py files: `ruff check`, using ruff from the nearest .venv (e.g. backend/.venv)
  or from PATH (skipped if ruff isn't installed).
- .ts/.tsx files: `tsc -b` in the nearest folder with a tsconfig.json, which follows
  Vite's project references, then `oxlint` on the file, which includes the jsx-a11y
  accessibility rules (each skipped if it isn't installed locally).
Problems exit with code 2 so Claude sees them and can fix them.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd, cwd=None):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        print((result.stdout + result.stderr).strip(), file=sys.stderr)
        sys.exit(2)


def find_ruff(path):
    for folder in path.parents:
        venv_ruff = folder / ".venv" / "bin" / "ruff"
        if venv_ruff.exists():
            return str(venv_ruff)
    return shutil.which("ruff")


def main():
    data = json.load(sys.stdin)
    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path:
        return
    path = Path(file_path)

    if path.suffix == ".py":
        ruff = find_ruff(path)
        if ruff:
            run([ruff, "check", str(path)])

    elif path.suffix in (".ts", ".tsx"):
        for folder in path.parents:
            if (folder / "tsconfig.json").exists():
                tsc = folder / "node_modules" / ".bin" / "tsc"
                if tsc.exists():
                    run([str(tsc), "-b"], cwd=folder)
                oxlint = folder / "node_modules" / ".bin" / "oxlint"
                if oxlint.exists():
                    run([str(oxlint), str(path)], cwd=folder)
                return


if __name__ == "__main__":
    main()
