"""The page fit estimate (app/page_fit.py): a resume on two pages with no section split across
the break, and a cover letter on one. What tailoring, the chat, and the draft do with it is
tested with them (tests/test_suggestions.py, test_chat.py, and test_drafts.py)."""

import re
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import page_fit
from app.documents import COVER_LETTER, RESUME
from app.page_fit import (
    BULLET_INDENT,
    CHARS_PER_LINE,
    LINES_PER_PAGE,
    PageFit,
    PageMark,
    budget_text,
    fit,
    lines_used,
    page_mark,
    part_lines,
)
from app.plain_text import Output, OutputPart
from tests.test_sections_skills import resume


def output(*parts: tuple[str, int]) -> Output:
    """Parts with the given number of one-line rows (after a title line)."""
    made = [OutputPart(label=label, text="\n".join([label] + ["x"] * (lines - 1)))
            for label, lines in parts]
    return Output(parts=made, text="")


def test_lines_wrap_and_bullets_wrap_past_their_marker():
    assert part_lines("short") == 1
    assert part_lines("x" * (CHARS_PER_LINE + 1)) == 2
    # A bullet's text is narrower than a full line.
    assert part_lines("- " + "x" * (CHARS_PER_LINE - 2)) == 2
    assert part_lines("Title\n- one\n- two") == 3
    # The header's name is set larger.
    assert part_lines("Sam\nEngineer", header=True) == 3


def test_a_section_that_doesnt_fit_starts_the_next_page_instead_of_splitting():
    result = fit(output(("Header", 10), ("Experience", 30), ("Projects", 15)), 2)
    # 10 + 1 + 30 = 41 lines; Projects needs 16 more, so it starts page 2.
    assert result.page_starts == ["Projects"]
    assert result.fits and result.too_long == []
    assert result.pages == 1.3
    assert result.spare_lines == LINES_PER_PAGE - 15


def test_too_many_pages_doesnt_fit_and_says_by_how_much():
    result = fit(output(("Header", 40), ("Experience", 40), ("Projects", 40)), 2)
    assert result.page_starts == ["Experience", "Projects"]
    assert not result.fits
    assert result.pages == 2.8
    assert result.spare_lines == -40


def test_a_section_too_long_for_a_page_is_reported():
    result = fit(output(("Header", 5), ("Experience", LINES_PER_PAGE + 5)), 2)
    assert result.too_long == ["Experience"]
    # It's counted as running onto the next page, and doesn't fit even within two pages.
    assert not result.fits
    assert result.page_starts == ["Experience"]
    assert result.pages == 2.1


def test_empty_parts_take_no_space():
    result = fit(Output(parts=[OutputPart(label="Header", text=""),
                               OutputPart(label="Summary", text="Summary")], text=""), 1)
    assert result.pages == round(1 / LINES_PER_PAGE, 1) and result.fits


def test_each_document_says_whether_it_fits(client: TestClient, db: Session, account_id: int):
    doc = resume(db, account_id, "Tech", sent=False)
    body = client.get(f"/api/resumes/{doc.resume_id}").json()
    assert body["fit"] | {"pages": 0} == {"limit": 2, "pages": 0, "fits": True,
                                         "page_starts": [], "too_long": [],
                                         "spare_lines": body["fit"]["spare_lines"]}


def test_claude_is_told_the_budget_from_the_same_constants():
    told = budget_text(RESUME)
    assert told.startswith(f"Page budget: the resume should fit on 2 pages, of {LINES_PER_PAGE} "
                           f"lines each. A line holds about {CHARS_PER_LINE} characters, and a "
                           f"bullet's text about {CHARS_PER_LINE - BULLET_INDENT}")
    assert "no section is ever split" in told
    letter = budget_text(COVER_LETTER)
    assert "the cover letter should fit on 1 page," in letter and "the greeting" in letter


def test_lines_used_counts_every_part_and_the_gaps_between_them():
    # The header's name counts twice: 2 + 1, a blank line, then 2.
    assert lines_used(Output(parts=[OutputPart(label="Header", text="Sam\nEngineer"),
                                    OutputPart(label="Summary", text="Summary\nI build."),
                                    OutputPart(label="Empty", text="")], text="")) == 6
    assert lines_used(Output(parts=[], text="")) == 0


def test_a_change_is_marked_only_when_it_takes_the_document_past_its_pages():
    def estimate(spare: int, too_long: tuple[str, ...] = ()) -> PageFit:
        return PageFit(limit=2, pages=2.0, fits=spare >= 0 and not too_long, page_starts=[],
                       too_long=list(too_long), spare_lines=spare)

    # Over by three lines after it, from within the pages.
    assert page_mark(estimate(2), estimate(-3)) == PageMark(limit=2, pages=2.0, over_lines=3,
                                                            too_long=[])
    # Further over than before.
    assert page_mark(estimate(-1), estimate(-3)).over_lines == 3
    # Still within the pages, or less over than before: not marked.
    assert page_mark(estimate(5), estimate(1)) is None
    assert page_mark(estimate(-5), estimate(-3)) is None
    # A section it makes too long for a page, even with lines to spare.
    assert page_mark(estimate(9), estimate(4, ("Experience",))).too_long == ["Experience"]
    assert page_mark(estimate(9, ("Experience",)), estimate(9, ("Experience",))) is None


def test_the_front_ends_line_estimate_uses_the_same_numbers():
    # Rows that wrap say so as they're worked on (frontend/src/shared/lineFit.ts).
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "shared"
              / "lineFit.ts").read_text()
    found = dict(re.findall(r"export const (CHARS_PER_LINE|BULLET_INDENT) = (\d+)", source))
    assert found == {"CHARS_PER_LINE": str(page_fit.CHARS_PER_LINE),
                     "BULLET_INDENT": str(page_fit.BULLET_INDENT)}
