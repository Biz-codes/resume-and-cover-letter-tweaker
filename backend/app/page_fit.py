"""Whether a resume fits on two pages, and a cover letter on one (docs/APP_FLOW.md, "Fitting on
the page"; phase 5 step 4 in docs/BUILD_PLAN.md).

An estimate, since the app doesn't lay out the printed page: the constants below stand for the
user's formatting (Calibri 11 with 0.5" margins on a Letter page). Each part of the
plain-text output (app/plain_text.py: the header, then each section, or a letter's greeting,
paragraphs, and sign-off) takes its lines wrapped at CHARS_PER_LINE, plus a blank line before it.
Parts are placed in order, and one that doesn't fit in what's left of a page starts the next
page, so no section is ever split across the break. A part too long for a whole page can't be
placed without splitting it; it's reported to be trimmed (and counted as running onto the next
page, so the page count shows how far over it is).

Settings per document type, font, and template are question 27 in docs/OPEN_QUESTIONS.md.
"""

import math

from pydantic import BaseModel

from app.plain_text import Output

# The user's formatting: a Letter page with 0.5" margins (a 7.5" by 10" text area) in Calibri 11,
# single spaced: about 110 characters per line (Calibri is narrow) and 53 lines per page.
CHARS_PER_LINE = 110
LINES_PER_PAGE = 53
# A bullet's text wraps under itself, past its marker.
BULLET_INDENT = 4
# A blank line between parts, and the header's name, which is set larger, counts twice.
PART_GAP = 1
NAME_LINES = 2

RESUME_PAGES = 2
LETTER_PAGES = 1


class PageFit(BaseModel):
    # The most pages the document should take.
    limit: int
    # About how many pages it takes, to one decimal (a full last page is a whole one).
    pages: float
    # Within the limit, with no part too long for a page.
    fits: bool
    # The part that starts each page after the first, in order.
    page_starts: list[str]
    # Parts too long for a single page, which would have to split.
    too_long: list[str]
    # Lines left on the last page, or how many lines over the limit (negative).
    spare_lines: int


def wrapped(text: str, width: int = CHARS_PER_LINE) -> int:
    """How many lines a line of text takes, wrapped at `width` (an empty one takes one)."""
    return max(1, math.ceil(len(text) / width))


def part_lines(text: str, *, header: bool = False) -> int:
    lines = text.split("\n")
    total = 0
    for index, line in enumerate(lines):
        if line.startswith("- "):
            total += wrapped(line[2:], CHARS_PER_LINE - BULLET_INDENT)
        else:
            total += wrapped(line)
        if header and index == 0:
            total += NAME_LINES - 1
    return total


def fit(output: Output, limit: int) -> PageFit:
    pages = 1
    used = 0
    page_starts: list[str] = []
    too_long: list[str] = []
    for part in output.parts:
        if not part.text:
            continue
        lines = part_lines(part.text, header=part.label == "Header")
        if lines > LINES_PER_PAGE:
            too_long.append(part.label)
        gap = PART_GAP if used else 0
        if used and used + gap + lines > LINES_PER_PAGE:
            # It starts the next page rather than splitting.
            pages += 1
            page_starts.append(part.label)
            used = lines
        else:
            used += gap + lines
        # A part too long for a page runs onto the ones after it.
        while used > LINES_PER_PAGE:
            pages += 1
            used -= LINES_PER_PAGE
    estimate = round(pages - 1 + used / LINES_PER_PAGE, 1)
    spare = (limit - pages) * LINES_PER_PAGE + (LINES_PER_PAGE - used)
    return PageFit(limit=limit, pages=estimate, fits=pages <= limit and not too_long,
                   page_starts=page_starts, too_long=too_long, spare_lines=spare)
