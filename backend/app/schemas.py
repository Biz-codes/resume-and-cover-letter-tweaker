"""Field types shared by the request bodies.

Text is trimmed. Optional fields treat a blank value as empty (null), so clearing a field
in a form clears the column instead of saving whitespace.
"""

from typing import Annotated

from pydantic import BeforeValidator, Field, StringConstraints


def blank_to_none(value: object) -> object:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def RequiredText(max_length: int | None = None):  # noqa: N802 (used like a type)
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1,
                                            max_length=max_length)]


def OptionalText(max_length: int | None = None):  # noqa: N802 (used like a type)
    return Annotated[Annotated[str, StringConstraints(max_length=max_length)] | None,
                     BeforeValidator(blank_to_none), Field(default=None)]
