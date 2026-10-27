#!/usr/bin/env python3
"""PreToolUse hook: block Claude from reading or editing secrets.

Protected: .env and .env.* files (except .env.example), which hold the Anthropic API key
and database credentials. Exit code 2 blocks the tool call and shows the reason to Claude.

For Bash, heredoc bodies (text being written to a file or fed to a script) are only checked
on lines that look like they access a file, so a doc or comment that merely mentions the
env file isn't blocked. The command lines themselves are always checked.
"""
import json
import re
import sys

PROTECTED = re.compile(r"(^|[\s/'\"=*(])\.env(?!\.example)(\.[\w.-]+)?(?=$|[\s'\";|&)])")
HEREDOC_START = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")
FILE_ACCESS = re.compile(
    r"\b(open|read_text|read_bytes|write_text|load_dotenv|dotenv_values|cat|less|more|head|"
    r"tail|source|cp|mv|rm|sed|grep|awk)\b|<|>"
)


def bash_targets(command: str) -> list[str]:
    """Command lines, plus heredoc body lines that look like file access."""
    targets = []
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        targets.append(line)
        terminators = [m.group(2) for m in HEREDOC_START.finditer(line)]
        i += 1
        for terminator in terminators:
            while i < len(lines) and lines[i].strip() != terminator:
                if FILE_ACCESS.search(lines[i]):
                    targets.append(lines[i])
                i += 1
            i += 1  # the terminator line
    return targets


def main():
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input", {})

    if data.get("tool_name") == "Bash":
        targets = bash_targets(tool_input.get("command", ""))
    else:
        targets = [tool_input.get("file_path", ""), tool_input.get("path", ""), tool_input.get("pattern", "")]

    for target in targets:
        if target and PROTECTED.search(target):
            print(
                "Blocked: .env files hold secrets (API key, database credentials). "
                "Ask the user to make this change themselves.",
                file=sys.stderr,
            )
            sys.exit(2)


if __name__ == "__main__":
    main()
