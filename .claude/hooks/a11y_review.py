#!/usr/bin/env python3
"""Hooks that make sure every front end change gets an accessibility review (the /a11y skill).

- `record` (PostToolUse on Edit|Write): notes each edited component, page, stylesheet, or
  component test under frontend/src (not the shared helpers in src/test/) in a per-session
  list in the temp folder.
- `remind` (Stop): if the list isn't empty, clears it and blocks the stop with exit code 2,
  telling Claude to run /a11y, starting with those files and then covering the whole front
  end. When Claude is already continuing because of
  this hook (stop_hook_active), it lets the stop through, so it never loops.
"""
import json
import sys
import tempfile
from pathlib import Path


def pending_file(session_id):
    return Path(tempfile.gettempdir()) / f"claude-a11y-{session_id or 'default'}.txt"


def needs_review(path):
    parts = path.parts
    if "frontend" not in parts or "src" not in parts or "test" in parts:
        return False
    return path.suffix in (".tsx", ".css")


def record(data):
    file_path = data.get("tool_input", {}).get("file_path", "")
    if file_path and needs_review(Path(file_path)):
        with pending_file(data.get("session_id")).open("a") as pending:
            pending.write(file_path + "\n")


def remind(data):
    pending = pending_file(data.get("session_id"))
    if not pending.exists():
        return
    files = sorted(set(pending.read_text().split()))
    pending.unlink()
    if not files or data.get("stop_hook_active"):
        return
    print("Front end files changed this turn:\n"
          + "\n".join(f"  - {name}" for name in files)
          + "\nRun the /a11y skill: start with these files, then review the whole front end "
          "against its checklist (a change in one place often affects others), fix what it "
          "finds, and make sure the tests reach every state the code renders, calling "
          "expectNoA11yViolations for each state a test passes through before it ends.",
          file=sys.stderr)
    sys.exit(2)


def main():
    data = json.load(sys.stdin)
    {"record": record, "remind": remind}[sys.argv[1]](data)


if __name__ == "__main__":
    main()
