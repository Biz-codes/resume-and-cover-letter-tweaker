#!/usr/bin/env python3
"""PreToolUse hook: block Claude from reading or editing secrets.

Protected: .env and .env.* files (except .env.example), which hold the Anthropic API key
and database credentials. Exit code 2 blocks the tool call and shows the reason to Claude.
"""
import json
import re
import sys

PROTECTED = re.compile(r"(^|[\s/'\"=*])\.env(?!\.example)(\.[\w.-]+)?(?=$|[\s'\";|&)])")


def main():
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input", {})

    if data.get("tool_name") == "Bash":
        targets = [tool_input.get("command", "")]
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
