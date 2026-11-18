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

Tailoring (app/suggestions.py) and the chat (app/chat.py) are told the page budget (budget_text)
and how many lines each section takes now (section_lines), and the page estimates Claude's draft
as the user has it (app/drafts.py, draft_fit). A chat proposal still waiting that would take
the document past its pages is marked (page_mark, through app/proposals.py's PageMarks).

Settings per document type, font, and template are question 27 in docs/OPEN_QUESTIONS.md.
"""

import math
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.documents import Kind, SectionTree, load_tree
from app.plain_text import Output, document_output, section_text

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


class PageMark(BaseModel):
    """A change that would take the document past its pages, or make a section too long for
    one (docs/APP_FLOW.md, "Fitting on the page"): what the document would take after it."""

    limit: int
    pages: float
    # How many lines over its pages it would be (0 when it's only a section too long).
    over_lines: int
    # The sections it would make too long for one page.
    too_long: list[str]


def page_mark(before: PageFit, after: PageFit) -> PageMark | None:
    """The mark for a change, from the estimates before and after it: only when it leaves the
    document not fitting and it's the cause, by adding lines past the limit or by making a
    section too long for a page. A change that trims a document already over isn't marked."""
    new_long = [label for label in after.too_long if label not in before.too_long]
    over = after.spare_lines < 0 and after.spare_lines < before.spare_lines
    if not (new_long or over):
        return None
    return PageMark(limit=after.limit, pages=after.pages,
                    over_lines=-after.spare_lines if over else 0, too_long=new_long)


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


def limit_of(kind: Kind) -> int:
    return RESUME_PAGES if kind.prefix == "resume" else LETTER_PAGES


def document_fit(db: Session, kind: Kind, doc: Any) -> PageFit:
    """Whether the document as it's saved now fits on its pages."""
    sections = load_tree(db, kind, getattr(doc, kind.doc_id))
    return fit(document_output(db, kind, doc, sections), limit_of(kind))


def section_lines(kind: Kind, section: SectionTree) -> int:
    """How many lines a section takes as it prints (none for an empty letter paragraph)."""
    text = section_text(kind, section)
    return part_lines(text) if text else 0


def lines_used(output: Output) -> int:
    """All the lines the output's parts take, with the blank lines between them, ignoring page
    breaks: with no sections, what everything but the sections takes."""
    sizes = [part_lines(part.text, header=part.label == "Header")
             for part in output.parts if part.text]
    return sum(sizes) + PART_GAP * max(0, len(sizes) - 1)


def fit_json(result: PageFit, other_lines: int) -> dict[str, Any]:
    """The estimate as Claude reads it, with what everything but the sections takes."""
    return {**result.model_dump(), "lines_outside_sections": other_lines}


# What tailoring and the chat are told about the page budget (docs/APP_FLOW.md, "Fitting on the
# page"). The numbers come from the constants above.
BUDGET = """\
Page budget: the {doc} should fit on {pages}, of {lines} lines each. A line holds about \
{chars} characters, and a bullet's text about {bullet_chars}, since it wraps past its marker. \
The {parts} are placed in order with a blank line between them, and a section that doesn't \
fit in what's left of a page starts the next one, leaving the rest of that page blank, so no \
section is ever split. A section longer than one page doesn't fit at all. Keep the {doc} \
within its pages: when it's over, trim first (a shorter wording, or leaving out the item that \
fits the posting least), and when there's room, don't add only to fill it."""


def budget_text(kind: Kind) -> str:
    limit = limit_of(kind)
    letter = kind.prefix == "cover_letter"
    return BUDGET.format(
        doc="cover letter" if letter else "resume",
        pages="1 page" if limit == 1 else f"{limit} pages", lines=LINES_PER_PAGE,
        chars=CHARS_PER_LINE, bullet_chars=CHARS_PER_LINE - BULLET_INDENT,
        parts=("header, the greeting, each paragraph's section, and the sign-off" if letter
               else "header and the sections"))


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
