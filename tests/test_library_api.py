"""JSON contract of the library, book, Markdown and progress endpoints."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

Client = tuple[TestClient, Path]


def _books(payload: dict[str, object]) -> dict[str, dict[str, object]]:
    rows = payload["books"]
    assert isinstance(rows, list)
    return {str(row["rel"]): row for row in rows}


def test_library_lists_books_with_contract_shape(client: Client) -> None:
    test_client, _state = client

    payload = test_client.get("/api/library").json()

    assert set(payload) == {
        "books",
        "groups",
        "category_options",
        "organize_available",
        "organize_status",
        "book_count",
        "resume",
        "resume_notes",
        "recent",
        "relocation_notice",
    }
    books = _books(payload)
    assert set(books) == {"note.md", "sub/a.pdf"}  # hidden dir and .bin are excluded
    assert payload["book_count"] == 2
    pdf, md = books["sub/a.pdf"], books["note.md"]
    assert pdf["kind"] == "pdf" and md["kind"] == "md"
    assert pdf["page_count"] == 3 and md["page_count"] is None
    assert pdf["thumb_url"] == "/thumb.jpg?path=sub/a.pdf&width=300"
    assert md["thumb_url"] == ""
    assert md["title"] == "Title"
    assert pdf["shelf"] == "sub" and md["shelf"] == "Unfiled"
    assert {"category_id", "category_name", "percent", "last_read_label", "last_read_at"} <= set(
        pdf
    )
    assert pdf["last_read_at"] is None
    assert payload["resume"] is None
    assert payload["recent"] == []
    assert payload["organize_available"] is False
    assert payload["relocation_notice"] == ""
    groups = payload["groups"]
    assert isinstance(groups, list)
    assert {group["id"] for group in groups} == {"sub", "unfiled"}
    assert payload["category_options"] == [
        {"id": group["id"], "name": group["name"]} for group in groups
    ]


def test_library_reflects_progress_resume_and_notes(client: Client) -> None:
    test_client, _state = client
    assert (
        test_client.post("/api/progress", json={"path": "sub/a.pdf", "page": 2}).status_code == 200
    )
    assert (
        test_client.post("/api/progress", json={"path": "note.md", "scroll": 0.5}).status_code
        == 200
    )
    test_client.post(
        "/api/notepad/notes",
        json={"book": "note.md", "kind": "md", "quote": "snake_case"},
    )

    payload = test_client.get("/api/library").json()

    books = _books(payload)
    assert books["sub/a.pdf"]["page"] == 2
    assert books["sub/a.pdf"]["percent"] == 67
    assert books["note.md"]["percent"] == 50
    assert str(books["note.md"]["last_read_at"]).startswith("20")
    resume = payload["resume"]
    assert resume["rel"] == "note.md" and resume["kind"] == "md"
    assert resume["percent"] == 50 and resume["updated_at"]
    assert [item["rel"] for item in payload["recent"]] == ["sub/a.pdf"]
    assert payload["recent"][0]["page"] == 2 and payload["recent"][0]["page_count"] == 3
    assert [note["quote"] for note in payload["resume_notes"]] == ["snake_case"]
    assert payload["resume_notes"][0]["locator"].startswith("L")


def test_library_relocation_notice_is_shown_once(client: Client, library: Path) -> None:
    test_client, _state = client
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")

    first = test_client.get("/api/library").json()
    second = test_client.get("/api/library").json()

    assert "1 book kept their notes and place" in first["relocation_notice"]
    assert second["relocation_notice"] == ""
    assert "shelf/moved.pdf" in _books(first)


@pytest.mark.parametrize("content", [b"not a pdf at all", b"%PDF-1.4\nthis is not a PDF"])
def test_library_survives_a_corrupt_pdf(client: Client, library: Path, content: bytes) -> None:
    test_client, _state = client
    (library / "broken.pdf").write_bytes(content)

    response = test_client.get("/api/library")

    assert response.status_code == 200
    broken = _books(response.json())["broken.pdf"]
    assert broken["page_count"] is None and broken["percent"] == 0
    assert test_client.get("/api/book", params={"path": "broken.pdf"}).status_code == 200


def test_pdf_book_detail_builds_the_viewer_url(client: Client) -> None:
    test_client, _state = client

    detail = test_client.get("/api/book", params={"path": "sub/a.pdf"}).json()

    assert detail["kind"] == "pdf" and detail["rel"] == "sub/a.pdf"
    assert detail["page"] == 1 and detail["page_count"] == 3
    assert detail["error"] is None
    assert detail["progress"] == {"page": None, "scroll": None, "updated": None}
    viewer = urlparse(detail["viewer_url"])
    assert viewer.path == "/static/vendor/pdfjs/web/viewer.html"
    assert parse_qs(viewer.query) == {"file": ["/raw/sub/a.pdf"]}
    assert viewer.fragment == "page=1"


def test_pdf_book_detail_resumes_saved_page_and_clamps_requests(client: Client) -> None:
    test_client, _state = client
    test_client.post("/api/progress", json={"path": "sub/a.pdf", "page": 3})

    saved = test_client.get("/api/book", params={"path": "sub/a.pdf"}).json()
    deep = test_client.get("/api/book", params={"path": "sub/a.pdf", "page": "2"}).json()
    huge = test_client.get("/api/book", params={"path": "sub/a.pdf", "page": "99"}).json()
    junk = test_client.get("/api/book", params={"path": "sub/a.pdf", "page": "x"}).json()

    assert saved["page"] == 3 and saved["progress"]["page"] == 3
    assert saved["viewer_url"].endswith("#page=3")
    assert deep["page"] == 2 and deep["viewer_url"].endswith("#page=2")
    assert huge["page"] == 3
    assert junk["page"] == 1


def test_corrupt_pdf_detail_reports_an_error_not_a_failure(client: Client, library: Path) -> None:
    test_client, _state = client
    (library / "broken.pdf").write_bytes(b"not a pdf at all")

    detail = test_client.get("/api/book", params={"path": "broken.pdf"}).json()

    assert detail["kind"] == "pdf"
    assert detail["viewer_url"] is None and detail["page_count"] is None
    assert "not a readable PDF" in detail["error"]


def test_markdown_book_detail_and_content(client: Client) -> None:
    test_client, _state = client
    test_client.post("/api/progress", json={"path": "note.md", "scroll": 0.25})

    detail = test_client.get("/api/book", params={"path": "note.md"}).json()
    body = test_client.get("/api/book/markdown", params={"path": "note.md"}).json()

    assert detail["kind"] == "md" and detail["title"] == "Title"
    assert detail["viewer_url"] is None and detail["page_count"] is None
    assert detail["progress"]["scroll"] == 0.25
    assert body["rel"] == "note.md" and body["title"] == "Title"
    assert body["outline"] == [{"level": 1, "title": "Title", "line": 1}]
    assert body["progress"]["scroll"] == 0.25
    assert 'id="L1"' in body["html"]
    assert 'href="/book/sub/a.pdf"' in body["html"]
    assert "snake_case" in body["html"]


def test_markdown_endpoint_never_passes_raw_html_through(client: Client, library: Path) -> None:
    test_client, _state = client
    (library / "evil.md").write_text("# T\n\n<script>alert(1)</script>\n", encoding="utf-8")

    body = test_client.get("/api/book/markdown", params={"path": "evil.md"}).json()

    assert "<script>" not in body["html"]


def test_markdown_endpoint_rejects_pdfs(client: Client) -> None:
    test_client, _state = client

    response = test_client.get("/api/book/markdown", params={"path": "sub/a.pdf"})

    assert response.status_code == 400


def test_progress_get_reflects_saved_position(client: Client) -> None:
    test_client, _state = client
    empty = test_client.get("/api/progress", params={"path": "sub/a.pdf"}).json()
    assert empty == {"path": "sub/a.pdf", "page": None, "scroll": None, "updated": None}

    test_client.post("/api/progress", json={"path": "sub/a.pdf", "page": 2})
    test_client.post("/api/progress", json={"path": "note.md", "scroll": 0.75})
    pdf = test_client.get("/api/progress", params={"path": "sub/a.pdf"}).json()
    md = test_client.get("/api/progress", params={"path": "note.md"}).json()

    assert pdf["page"] == 2 and pdf["scroll"] is None and pdf["updated"] > 0
    assert md["scroll"] == 0.75 and md["page"] is None


def test_moved_book_detail_returns_a_redirect_body(client: Client, library: Path) -> None:
    test_client, _state = client
    test_client.post("/api/progress", json={"path": "sub/a.pdf", "page": 2})
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "renamed.pdf")

    response = test_client.get("/api/book", params={"path": "sub/a.pdf"})

    assert response.status_code == 200
    assert response.json() == {"redirect": "shelf/renamed.pdf"}
    moved = test_client.get("/api/book", params={"path": "shelf/renamed.pdf"}).json()
    assert moved["page"] == 2 and moved["progress"]["page"] == 2


def test_unknown_and_unsafe_paths_are_rejected_like_the_html_routes(client: Client) -> None:
    test_client, _state = client
    for endpoint in ("/api/book", "/api/book/markdown", "/api/progress"):
        assert test_client.get(endpoint, params={"path": "missing.pdf"}).status_code == 404
        assert test_client.get(endpoint, params={"path": "../outside.pdf"}).status_code == 400
        assert test_client.get(endpoint, params={"path": "/etc/passwd"}).status_code == 400
        assert test_client.get(endpoint, params={"path": "img.bin"}).status_code == 400
        assert test_client.get(endpoint).status_code == 422
