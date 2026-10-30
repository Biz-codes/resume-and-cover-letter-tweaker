---
name: commit-message
description: Write a commit message for the staged changes (what `git commit` would commit) at the length the user picks - succinct (one line), highlights (a subject plus one line per significant change), or verbose (a subject plus every meaningful change). Use when the user asks for a commit message. The git prepare-commit-msg hook runs it too.
argument-hint: "[succinct|highlights|verbose] [--raw]"
---

# Write a commit message

The user commits by hand. The message describes only the **staged** changes, since those are what the commit will hold; unstaged and untracked files are left out. Never stage, commit, or change files; only write the message.

## Arguments

- A level: `succinct` (or `1`), `highlights` (or `2`), `verbose` (or `3`). Without one, ask (step 1). The git hook passes the level its own question got.
- `--raw`: print only the message as plain text: no ``` code block fences, and nothing before or after it. The git hook (`.githooks/prepare-commit-msg`) writes this output straight into the commit message file.

## Steps

1. **Ask for the level** if no argument gave one. Always ask, never assume one. Use AskUserQuestion with the question exactly "What type of commit message do you want to add?", header "Commit msg", and these four options:
   - **Succinct**: one line, up to 72 characters.
   - **Highlights**: a subject line, then one line for each of the most significant changes (2 to 5).
   - **Verbose**: a subject line, then a bulleted list of every meaningful change, grouped by area.
   - **Write my own**: don't write a message. Instead, give a short plain list of what changed (areas and files), to help the user write it, and stop.

2. **Review the staged changes.** Run these yourself; don't rely on what you remember from the conversation, since the user may have changed or staged files by hand:
   - `git diff --cached --stat` and `git diff --cached` (new staged files appear here in full)
   - `git log -5 --format='%B---'` for the project's style

   If nothing is staged, say so and stop: suggest `git add` for the files to commit. With `--raw`, print nothing at all, not even a note, since the output becomes the commit message. Look at every staged file before writing, not just the first few or the newest: the message covers the whole change. Read enough of the diff to know *why* things changed, not just which files did. Check `docs/BUILD_PLAN.md` in the diff: a step newly checked off names the commit. When several things changed, the subject names the biggest (usually that step), even at the succinct level, and smaller changes (tooling, a new skill) go in the body or are left out.

3. **Write the message** in the style of the recent commits:
   - Subject: what the change does, up to 72 characters, no period. When it finishes a BUILD_PLAN step, start with that step ("Phase 4 Step 2: ...").
   - Body (highlights and verbose): a blank line after the subject, then `- ` bullets wrapped at 72 characters, with continuation lines indented two spaces.
   - Highlights: only the changes a reader of the log would most need, one line each.
   - Verbose: every meaningful change, in this order: backend, front end, docs, tooling. Name new files and endpoints, rules and error codes, and renames the user will see.
   - Plain words, no filler (see `docs/WRITING_RULES.md`). Describe the change, not the conversation that led to it.
   - No `Co-Authored-By` line or any other trailer: the user's commits don't carry one.
   - Never mention or quote anything from `db/seed_personal/`, `.env` files, or other personal data, even if it's in the diff.

4. **Output.**
   - With `--raw`: the message only.
   - Otherwise: the message in a code block, then one line naming anything odd you noticed that the user may not want in this commit (an unrelated file, a debug leftover). Say nothing else.
