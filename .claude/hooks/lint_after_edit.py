#!/usr/bin/env python3
"""PostToolUse hook: lint or type-check a file right after Claude edits it.

- .py files: `ruff check` (skipped if ruff isn't installed).
- .ts/.tsx files: `tsc --noEmit` in the nearest folder with a tsconfig.json
  (skipped if there's no tsconfig or no local TypeScript install).
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


def main():
    data = json.load(sys.stdin)
    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path:
        return
    path = Path(file_path)

    if path.suffix == ".py":
        ruff = shutil.which("ruff")
        if ruff:
            run([ruff, "check", str(path)])

    elif path.suffix in (".ts", ".tsx"):
        for folder in path.parents:
            if (folder / "tsconfig.json").exists():
                tsc = folder / "node_modules" / ".bin" / "tsc"
                if tsc.exists():
                    run([str(tsc), "--noEmit", "-p", str(folder)], cwd=folder)
                return


if __name__ == "__main__":
    main()
