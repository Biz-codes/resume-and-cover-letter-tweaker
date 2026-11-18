"""What the app's Claude requests cost, from the usage the backend logs for each one
(backend/app/claude.py logs `response.usage` to backend/logs/app.log and its rotated copies).

Run from the project root: python3 scripts/usage_report.py [--since 2026-11-18] [--log DIR]
It prints, for each kind of request (the chat, tailoring, each writing check, and so on), how many
there were, their tokens, and their cost; then the cost by day, how much input was read from the
cache, and where the money went (input, cache writes, cache reads, output). See "API key and
cost" in docs/TECH_STACK.md for what the first measurement found.

The rates are Claude Opus 5.5's, per million tokens, as published in November 2026. Check them
against Anthropic's pricing page and update RATES when they change. Thinking is billed as output,
and the logged output_tokens include it.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

# Dollars per million tokens: input, cache writes (5-minute and 1-hour), cache reads, output.
RATES = {"input": 4.00, "write_5m": 5.00, "write_1h": 8.00, "read": 0.20, "output": 20.00}
FIELDS = list(RATES)

LOG_DIR = Path(__file__).resolve().parent.parent / "backend" / "logs"
LINE = re.compile(r"^(\d{4}-\d{2}-\d{2}) \S+ INFO app\.claude: Claude (.+?): BetaUsage\((.*)$")


def count(name: str, text: str) -> int:
    found = re.search(rf"\b{name}=(\d+)", text)
    return int(found.group(1)) if found else 0


def parse(line: str) -> dict | None:
    """One logged request's day, step, tokens, and cost, or None for any other line."""
    match = LINE.match(line)
    if not match:
        return None
    day, step, usage = match.groups()
    # The request's own totals come before its per-iteration list, except output_tokens, which
    # comes right after it.
    head = usage.split("iterations=")[0]
    output = (re.search(r"\], output_tokens=(\d+)", usage)
              or re.search(r"output_tokens=(\d+)", usage))
    row = {"day": day, "step": step,
           "input": count("input_tokens", head),
           "write_5m": count("ephemeral_5m_input_tokens", head),
           "write_1h": count("ephemeral_1h_input_tokens", head),
           "read": count("cache_read_input_tokens", head),
           "output": int(output.group(1)) if output else 0}
    row["cost"] = sum(row[field] * RATES[field] for field in FIELDS) / 1_000_000
    return row


def kind(step: str) -> str:
    """The kind of request, without the document it was for ("chat resume 17" → "chat")."""
    step = re.sub(r"\s*\d+$", "", step)
    return re.sub(r"^chat (resume|cover letter)$", "chat", step)


def read(log_dir: Path, since: str | None) -> list[dict]:
    rows = []
    # Oldest first: app.log.3, .2, .1, then app.log.
    paths = sorted(log_dir.glob("app.log.*"), key=lambda path: -int(path.suffix[1:] or 0))
    for path in [*paths, log_dir / "app.log"]:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            row = parse(line)
            if row and (since is None or row["day"] >= since):
                rows.append(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--since", help="only requests on or after this day (YYYY-MM-DD)")
    parser.add_argument("--log", type=Path, default=LOG_DIR, help="the backend's log folder")
    args = parser.parse_args()
    rows = read(args.log, args.since)
    if not rows:
        print(f"No logged Claude requests in {args.log}"
              + (f" since {args.since}." if args.since else "."))
        return 1

    by_kind: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_day: dict[str, float] = defaultdict(float)
    total: dict[str, float] = defaultdict(float)
    for row in rows:
        group = by_kind[kind(row["step"])]
        group["calls"] += 1
        total["calls"] += 1
        for field in [*FIELDS, "cost"]:
            group[field] += row[field]
            total[field] += row[field]
        by_day[row["day"]] += row["cost"]

    print(f"Claude requests from {rows[0]['day']} to {rows[-1]['day']}\n")
    header = (f"{'request':30} {'calls':>5} {'input':>8} {'cache write':>11} {'cache read':>10} "
              f"{'output':>8} {'cost':>8} {'per call':>8}")
    print(header)
    print("-" * len(header))

    def line(name: str, group: dict[str, float]) -> str:
        writes = group["write_5m"] + group["write_1h"]
        return (f"{name[:30]:30} {int(group['calls']):5} {int(group['input']):8} "
                f"{int(writes):11} {int(group['read']):10} {int(group['output']):8} "
                f"${group['cost']:7.2f} ${group['cost'] / group['calls']:7.3f}")

    for name, group in sorted(by_kind.items(), key=lambda item: -item[1]["cost"]):
        print(line(name, group))
    print("-" * len(header))
    print(line("all", total))

    print("\nBy day:")
    for day, cost in sorted(by_day.items()):
        print(f"  {day}  ${cost:.2f}")

    sent = total["input"] + total["write_5m"] + total["write_1h"] + total["read"]
    print(f"\nInput read from the cache: {total['read'] / sent:.0%}" if sent else "")
    spent = {"input": total["input"] * RATES["input"],
             "cache writes": total["write_5m"] * RATES["write_5m"]
             + total["write_1h"] * RATES["write_1h"],
             "cache reads": total["read"] * RATES["read"],
             "output": total["output"] * RATES["output"]}
    print("Where it went: " + ", ".join(
        f"{name} ${amount / 1_000_000:.2f} ({amount / 1_000_000 / total['cost']:.0%})"
        for name, amount in spent.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
