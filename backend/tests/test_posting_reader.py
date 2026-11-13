"""Reading a job posting from its url or pasted text (app/posting_reader.py), with stand-ins
for the page fetch and for Claude, so no test reaches the network."""

from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from app import posting_reader
from app.claude import get_client
from app.main import app
from app.posting_reader import Extracted, page_text

FOUND = Extracted(found=True, organization="Acme", role_title="Engineer",
                  description="Build things.\n- Python")


class FakeMessages:
    """Answers like client.beta.messages.stream, with a reply, an error, or a stop reason.
    `replies` answers a request for one reply shape (its output_format) differently, for a step
    that makes two requests (tailoring, then the writing check)."""

    def __init__(self, reply: Any = None) -> None:
        self.reply: Any = FOUND if reply is None else reply
        self.replies: dict[Any, Any] = {}
        self.stop_reason = "end_turn"
        self.calls: list[dict[str, Any]] = []

    @contextmanager
    def stream(self, **request: Any) -> Iterator[SimpleNamespace]:
        self.calls.append(request)
        reply = self.replies.get(request.get("output_format"), self.reply)
        if isinstance(reply, Exception):
            raise reply
        message = SimpleNamespace(stop_reason=self.stop_reason, parsed_output=reply,
                                  usage={"input_tokens": 1, "output_tokens": 1})
        yield SimpleNamespace(get_final_message=lambda: message)


@pytest.fixture
def claude(client: TestClient) -> Iterator[FakeMessages]:
    messages = FakeMessages()
    app.dependency_overrides[get_client] = lambda: SimpleNamespace(
        beta=SimpleNamespace(messages=messages))
    yield messages


@pytest.fixture
def page(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """The HTML the stand-in fetch returns, keyed by url."""
    pages: dict[str, str] = {}

    def download(url: str) -> str:
        if url not in pages:
            raise posting_reader.AppError(posting_reader.ErrorCode.POSTING_FETCH_FAILED)
        return pages[url]

    monkeypatch.setattr(posting_reader, "download", download)
    return pages


def read(client: TestClient, **body: str | None):
    return client.post("/api/job-postings/read", json=body)


def test_reads_a_posting_from_its_page(client: TestClient, claude: FakeMessages,
                                       page: dict[str, str]):
    page["https://jobs.example.com/1"] = "<html><body><h1>Engineer</h1><p>Build things.</p>"
    response = read(client, url="https://jobs.example.com/1")
    assert response.status_code == 200
    assert response.json() == {"organization": "Acme", "role_title": "Engineer",
                               "description": "Build things.\n- Python"}
    [request] = claude.calls
    assert request["model"] == "claude-opus-5-5"
    assert request["output_config"] == {"effort": "low"}
    assert request["output_format"] is Extracted
    content = request["messages"][0]["content"]
    assert content.startswith("Text of the web page at https://jobs.example.com/1:")
    assert "Engineer\nBuild things." in content


def test_reads_pasted_text_without_fetching(client: TestClient, claude: FakeMessages,
                                            page: dict[str, str]):
    # No page is set up, so fetching would fail.
    response = read(client, url="Jamie Lee, jamie@example.com", text="We're hiring an engineer.")
    assert response.status_code == 200
    assert claude.calls[0]["messages"][0]["content"].startswith("Text the job seeker pasted:")


def test_keeps_pasted_text_when_claude_finds_no_posting(client: TestClient,
                                                        claude: FakeMessages):
    claude.reply = Extracted(found=False, organization="", role_title="", description="")
    response = read(client, text="Notes from a call about the job.")
    assert response.json() == {"organization": "", "role_title": "",
                               "description": "Notes from a call about the job."}


def test_a_page_with_no_posting_asks_for_it_to_be_pasted(client: TestClient,
                                                         claude: FakeMessages,
                                                         page: dict[str, str]):
    page["https://example.com"] = "<p>Our blog</p>"
    claude.reply = Extracted(found=False, organization="", role_title="", description="")
    response = read(client, url="https://example.com")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "POSTING_FETCH_FAILED"


def test_a_page_that_cant_be_fetched_asks_for_it_to_be_pasted(client: TestClient,
                                                              claude: FakeMessages,
                                                              page: dict[str, str]):
    response = read(client, url="https://blocked.example.com")
    assert response.json()["error"]["code"] == "POSTING_FETCH_FAILED"
    assert claude.calls == []


def test_a_page_with_no_text_asks_for_it_to_be_pasted(client: TestClient,
                                                      claude: FakeMessages,
                                                      page: dict[str, str]):
    # Built by scripts in the browser, so there's nothing to read here.
    page["https://app.example.com"] = "<div id='root'></div><script>render()</script>"
    assert read(client, url="https://app.example.com").json()["error"]["code"] == (
        "POSTING_FETCH_FAILED")
    assert claude.calls == []


def test_needs_a_web_address_or_pasted_text(client: TestClient, claude: FakeMessages):
    for body in ({"url": "Jamie Lee, jamie@example.com"}, {"url": None}, {"text": "  "}):
        error = read(client, **body).json()["error"]
        assert (error["code"], error["field"]) == ("VALIDATION_FAILED", "url")
    assert claude.calls == []


def test_claude_failing_is_ai_unavailable(client: TestClient, claude: FakeMessages):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.reply = anthropic.APIConnectionError(request=request)
    response = read(client, text="A posting.")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_UNAVAILABLE"


def test_a_rejected_key_says_to_check_it(client: TestClient, claude: FakeMessages):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.reply = anthropic.AuthenticationError(
        "invalid x-api-key", response=httpx.Response(401, request=request), body=None)
    error = read(client, text="A posting.").json()["error"]
    assert error["code"] == "AI_UNAVAILABLE"
    assert "API key" in error["message"]


def test_a_reply_cut_short_is_ai_unavailable(client: TestClient, claude: FakeMessages):
    claude.stop_reason = "max_tokens"
    assert read(client, text="A posting.").json()["error"]["code"] == "AI_UNAVAILABLE"


def test_no_api_key_says_where_to_add_it(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.claude.get_settings",
                        lambda: SimpleNamespace(anthropic_api_key=None))
    get_client.cache_clear()
    error = read(client, text="A posting.").json()["error"]
    get_client.cache_clear()
    assert error["code"] == "AI_UNAVAILABLE"
    assert "backend/.env" in error["message"]


def test_page_text_keeps_visible_text_and_job_data():
    html = """<html><head><title>Engineer</title><style>p {}</style>
      <script type="application/ld+json">{"@type": "JobPosting", "title": "Engineer"}</script>
      <script>track()</script><script type="application/ld+json">not json</script></head>
      <body><nav>Jobs</nav><h1>Engineer</h1>
      <ul><li>Python</li>   <li>SQL</li></ul><noscript>Turn on scripts</noscript></body></html>"""
    assert page_text(html) == (
        '{"@type": "JobPosting", "title": "Engineer"}\nEngineer\nJobs\nEngineer\nPython\nSQL')


@pytest.mark.parametrize("answer", [
    httpx.ConnectError("refused"),
    httpx.Response(403, text="Forbidden"),
    httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"),
])
def test_download_failures_ask_for_the_posting_to_be_pasted(monkeypatch: pytest.MonkeyPatch,
                                                            answer: Exception | httpx.Response):
    def get(url: str, **options: Any) -> httpx.Response:
        if isinstance(answer, Exception):
            raise answer
        answer.request = httpx.Request("GET", url)
        return answer

    monkeypatch.setattr(posting_reader.httpx, "get", get)
    with pytest.raises(posting_reader.AppError) as raised:
        posting_reader.download("https://jobs.example.com/1")
    assert raised.value.code == "POSTING_FETCH_FAILED"


def test_download_returns_the_html(monkeypatch: pytest.MonkeyPatch):
    def get(url: str, **options: Any) -> httpx.Response:
        assert options["follow_redirects"] is True
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"},
                              text="<p>Hi</p>", request=httpx.Request("GET", url))

    monkeypatch.setattr(posting_reader.httpx, "get", get)
    assert posting_reader.download("https://jobs.example.com/1") == "<p>Hi</p>"
