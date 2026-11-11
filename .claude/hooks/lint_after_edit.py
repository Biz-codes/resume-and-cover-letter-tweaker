#!/usr/bin/env python3
"""PostToolUse hook: lint or type-check a file right after Claude edits it.

- .py files: `ruff check`, using ruff from the nearest .venv (e.g. backend/.venv)
  or from PATH (skipped if ruff isn't installed).
- .ts/.tsx files: `tsc -b` in the nearest folder with a tsconfig.json, which follows
  Vite's project references, then `oxlint` on the file, which includes the jsx-a11y
  accessibility rules (each skipped if it isn't installed locally). Hooks don't load
  nvm from the shell profile, so both run with nvm's Node for the version in .nvmrc
  (or nvm's default) first on the PATH, falling back to whatever Node is on the PATH.
Problems exit with code 2 so Claude sees them and can fix them.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd, cwd=None, env=None):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print((result.stdout + result.stderr).strip(), file=sys.stderr)
        sys.exit(2)


def find_ruff(path):
    for folder in path.parents:
        venv_ruff = folder / ".venv" / "bin" / "ruff"
        if venv_ruff.exists():
            return str(venv_ruff)
    return shutil.which("ruff")


def _version_key(name):
    return tuple(int(part) for part in re.findall(r"\d+", name))


def nvm_node_bin(path):
    """The bin folder of nvm's Node matching the nearest .nvmrc (or nvm's default
    alias), newest first, or None when nvm has no match."""
    versions = Path(os.environ.get("NVM_DIR", Path.home() / ".nvm")) / "versions" / "node"
    if not versions.is_dir():
        return None
    wanted = None
    for folder in path.parents:
        nvmrc = folder / ".nvmrc"
        if nvmrc.exists():
            wanted = nvmrc.read_text().strip()
            break
    if wanted is None:
        alias = versions.parent.parent / "alias" / "default"
        wanted = alias.read_text().strip() if alias.exists() else ""
    wanted = wanted.lstrip("v")
    installed = sorted((d for d in versions.iterdir() if (d / "bin" / "node").exists()),
                       key=lambda d: _version_key(d.name), reverse=True)
    for folder in installed:
        version = folder.name.lstrip("v")
        if not wanted or version == wanted or version.startswith(wanted + "."):
            return folder / "bin"
    return None


def node_env(path):
    env = dict(os.environ)
    node_bin = nvm_node_bin(path)
    if node_bin:
        env["PATH"] = f"{node_bin}{os.pathsep}{env.get('PATH', '')}"
    return env


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
        env = node_env(path)
        for folder in path.parents:
            if (folder / "tsconfig.json").exists():
                tsc = folder / "node_modules" / ".bin" / "tsc"
                if tsc.exists():
                    run([str(tsc), "-b"], cwd=folder, env=env)
                oxlint = folder / "node_modules" / ".bin" / "oxlint"
                if oxlint.exists():
                    run([str(oxlint), str(path)], cwd=folder, env=env)
                return


if __name__ == "__main__":
    main()
