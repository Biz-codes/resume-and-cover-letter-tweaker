"""Dismissing a writing flag (docs/FRONTEND_CHECKS.md, "Writing rules"): the user decides a flag
the writing check found doesn't apply, so it stops counting (no "Flagged" badge or tag once every
flag on the text is dismissed) and shows apart, with Restore. Flags are kept wherever they're
found (a bullet's or narrative content's `flags`, Claude's draft, a chat proposal, a review's fix),
so each is dismissed where it is, as `"dismissed": true` on the flag. Nothing else changes.

A flag is named by its rule's kind and text and the words that break it, so checking the same
words again keeps it dismissed (carry_dismissed); once the text changes so the words differ, it's
a new flag. Claude's text the user keeps takes its flags as they are, dismissed ones included.
"""

from typing import Any, Literal

from pydantic import BaseModel

from app.errors import AppError, ErrorCode


class FlagChoice(BaseModel):
    """Which flag, and whether it's dismissed (False restores it)."""

    kind: Literal["term", "pattern", "tone"]
    rule: str
    quote: str
    dismissed: bool


def _name(flag: dict[str, Any]) -> tuple[Any, Any, Any]:
    return flag.get("kind"), flag.get("rule"), flag.get("quote")


def set_dismissed(flags: list[dict[str, Any]] | None, choice: FlagChoice) -> list[dict[str, Any]]:
    """The flags with the chosen one dismissed or restored, as a new list (so a JSONB column sees
    the change). NOT_FOUND when it isn't there (the text was checked again since)."""
    chosen = (choice.kind, choice.rule, choice.quote)
    if not any(_name(flag) == chosen for flag in flags or []):
        raise AppError(ErrorCode.NOT_FOUND,
                       "That flag isn't there anymore. The text was checked again.")
    updated = []
    for flag in flags or []:
        flag = dict(flag)
        if _name(flag) == chosen:
            # Left out when false, as the check saves it.
            if choice.dismissed:
                flag["dismissed"] = True
            else:
                flag.pop("dismissed", None)
        updated.append(flag)
    return updated


def carry_dismissed(old: list[dict[str, Any]] | None,
                    new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A new check's flags, keeping dismissed the ones the old check found for the same words."""
    gone = {_name(flag) for flag in old or [] if flag.get("dismissed")}
    return [{**flag, "dismissed": True} if _name(flag) in gone else flag for flag in new]


def counted(flags: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """The flags that still count: those not dismissed."""
    return [flag for flag in flags or [] if not flag.get("dismissed")]
