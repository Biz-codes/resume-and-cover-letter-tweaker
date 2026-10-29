"""The plain-text output of a resume or cover letter (docs/APP_FLOW.md, "Output").

The output comes in parts (the header, each section, and a cover letter's greeting and
closing), so the page can offer a copy button for each one as well as for the whole document.
"""

from pydantic import BaseModel

from app.documents import Entry, SectionTree
from app.models import Header


class OutputPart(BaseModel):
    # What the part is, for the page only (a cover letter never prints its section titles).
    label: str
    text: str


class Output(BaseModel):
    parts: list[OutputPart]
    text: str


def line(*parts: str | None) -> str:
    """The non-empty parts, separated by " | "."""
    return " | ".join(part for part in parts if part)


def header_text(header: Header) -> str:
    contacts = line(header.email, header.phone, header.location, header.linkedin_url,
                    header.github_url, header.portfolio_url)
    return "\n".join(part for part in (header.full_name, header.headline, contacts) if part)


def entry_lines(entry: Entry) -> list[str]:
    values = entry.values
    bullets = [f"- {bullet.text}" for bullet in entry.bullets]
    skills = ", ".join(skill.text for skill in entry.skills)
    match entry.kind:
        case "narrative" | "bullet":
            text = values["content"] or ""
            return [text if entry.kind == "narrative" else f"- {text}"]
        case "category":
            return [f"{values['category_name']}: {skills}"]
        case "experience":
            return [line(values["role_title"], values["organization"], values["location"],
                         values["dates"]), *bullets]
        case "project":
            return [line(values["project_title"], values["done_for"], values["dates"]),
                    *([f"Skills: {skills}"] if skills else []), *bullets]
        case "education":
            return [line(values["degree"], values["institution"], values["graduation"]),
                    *([values["details"]] if values["details"] else [])]


def section_body(section: SectionTree) -> str:
    """The section's entries, one per line, except that narrative content placed one after
    another runs together as one paragraph."""
    lines: list[str] = []
    after_narrative = False
    for entry in section.entries:
        if entry.kind == "narrative" and after_narrative:
            lines[-1] += " " + (entry.values["content"] or "")
        else:
            lines.extend(entry_lines(entry))
        after_narrative = entry.kind == "narrative"
    return "\n".join(lines)


def _output(parts: list[OutputPart]) -> Output:
    return Output(parts=parts, text="\n\n".join(part.text for part in parts if part.text))


def resume_output(header: Header | None, sections: list[SectionTree]) -> Output:
    """The header, then each section's title and content."""
    parts = [OutputPart(label="Header", text=header_text(header))] if header else []
    for section in sections:
        body = section_body(section)
        parts.append(OutputPart(label=section.title,
                                text=f"{section.title}\n{body}" if body else section.title))
    return _output(parts)


def letter_output(header: Header | None, sections: list[SectionTree], addressee: str | None,
                  sign_off: str | None, signature_name: str | None) -> Output:
    """The header, the greeting, one paragraph per section (no titles), then the sign-off and
    the name: the letter's signature_name, or the header's full_name when that's empty."""
    parts = [OutputPart(label="Header", text=header_text(header))] if header else []
    if addressee:
        parts.append(OutputPart(label="Greeting", text=f"Dear {addressee},"))
    parts.extend(OutputPart(label=section.title, text=section_body(section))
                 for section in sections)
    if sign_off:
        name = signature_name or (header.full_name if header else None)
        parts.append(OutputPart(label="Sign-off",
                                text=f"{sign_off},\n{name}" if name else f"{sign_off},"))
    return _output(parts)
