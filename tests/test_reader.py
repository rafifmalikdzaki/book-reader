import json
import os
from pathlib import Path
from typing import Self, cast

import pymupdf
import pytest
from elasticsearch import Elasticsearch
from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.library.models import Book
from book_reader.library.scan import Library
from book_reader.mdrender import render_markdown
from book_reader.pdf import PdfCache
from book_reader.search import ElasticSearch, Searcher, SearchUnavailable
from book_reader.sections import SectionIndex

JPEG_MAGIC = b"\xff\xd8\xff"
Client = tuple[TestClient, Path]


def _library_books(test_client: TestClient) -> dict[str, dict[str, object]]:
    rows = test_client.get("/api/library").json()["books"]
    return {str(row["rel"]): row for row in rows}


def test_raw_pdf_supports_range_requests(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/raw/sub/a.pdf", headers={"Range": "bytes=0-99"})
    assert response.status_code == 206
    assert len(response.content) == 100
    assert response.headers["content-range"].startswith("bytes 0-99/")
    assert response.headers["accept-ranges"] == "bytes"


def test_thumbnail_renders_caches_and_revalidates(client: Client) -> None:
    test_client, state = client
    response = test_client.get("/thumb.jpg", params={"path": "sub/a.pdf", "width": 240})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content.startswith(JPEG_MAGIC)
    assert "immutable" in response.headers["cache-control"]
    etag = response.headers["etag"]
    assert etag.startswith('W/"')
    assert len(list((state / "thumbs").glob("*-240.jpg"))) == 1

    repeat = test_client.get(
        "/thumb.jpg",
        params={"path": "sub/a.pdf", "width": 240},
        headers={"If-None-Match": etag},
    )
    assert repeat.status_code == 304
    assert repeat.content == b""
    assert repeat.headers["etag"] == etag

    wider = test_client.get("/thumb.jpg", params={"path": "sub/a.pdf", "width": 360})
    assert wider.status_code == 200
    assert wider.headers["etag"] != etag
    assert len(list((state / "thumbs").glob("*-360.jpg"))) == 1

    assert (
        test_client.get("/thumb.jpg", params={"path": "note.md", "width": 240}).status_code == 400
    )
    assert (
        test_client.get("/thumb.jpg", params={"path": "sub/a.pdf", "width": 100}).status_code == 422
    )


def test_path_traversal_is_rejected(client: Client) -> None:
    test_client, _state = client
    assert test_client.get("/thumb.jpg", params={"path": "../outside.pdf"}).status_code == 400
    assert test_client.get("/raw/..%2Foutside.pdf").status_code == 400
    assert test_client.get("/book/..%2F..%2Fetc%2Fpasswd").status_code == 400
    assert test_client.get("/api/book", params={"path": "../../etc/passwd"}).status_code == 400


def test_markdown_renders_links_images_and_code(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/api/book/markdown", params={"path": "note.md"})
    assert response.status_code == 200
    body = response.json()["html"]
    assert '">Title</h1>' in body
    assert 'href="/book/sub/a.pdf"' in body
    assert "language-python" in body
    assert 'src="/raw/sub/pic%20one.png"' in body
    assert "%2520" not in body


def test_fenced_code_info_string_cannot_inject_attributes() -> None:
    html = render_markdown('```python"><svg/onload=alert(1)>\nprint(1)\n```\n', file_rel="n.md")
    assert "&quot;&gt;&lt;svg/onload=alert(1)&gt;" in html
    assert "<svg" not in html


def test_progress_roundtrip_persists_page(client: Client) -> None:
    test_client, state = client
    assert test_client.post("/api/progress", json={"path": "sub/a.pdf", "page": 2}).json() == {
        "ok": True
    }
    assert test_client.get("/api/book", params={"path": "sub/a.pdf"}).json()["page"] == 2
    assert test_client.get("/api/library").json()["resume"]["rel"] == "sub/a.pdf"

    stored = json.loads((state / "progress.json").read_text(encoding="utf-8"))
    assert stored["books"]["sub/a.pdf"]["page"] == 2

    test_client.post("/api/progress", json={"path": "sub/a.pdf", "scroll": 0.5})
    stored = json.loads((state / "progress.json").read_text(encoding="utf-8"))
    assert stored["books"]["sub/a.pdf"] == {
        "page": 2,
        "scroll": 0.5,
        "updated": stored["books"]["sub/a.pdf"]["updated"],
    }


def test_search_finds_pdf_pages_and_markdown_lines(client: Client) -> None:
    test_client, _state = client
    pdf_hits = test_client.get(
        "/api/search", params={"path": "sub/a.pdf", "q": "HELLO-search"}
    ).json()
    assert pdf_hits["kind"] == "pdf"
    assert [hit["page"] for hit in pdf_hits["hits"]] == [1]

    md_hits = test_client.get("/api/search", params={"path": "note.md", "q": "Title"}).json()
    assert md_hits["kind"] == "md"
    assert md_hits["hits"][0]["line"] == 1

    empty = test_client.get("/api/search", params={"path": "note.md", "q": "  "}).json()
    assert empty["hits"] == []


def test_page_counts_and_raw_files(client: Client) -> None:
    test_client, _state = client
    counts = test_client.get("/api/pages").json()["counts"]
    assert counts == {"note.md": None, "sub/a.pdf": 3}
    raw = test_client.get("/raw/note.md")
    assert raw.status_code == 200
    assert b"# Title" in raw.content


def test_healthz(client: Client) -> None:
    test_client, _state = client
    assert test_client.get("/healthz").json() == {"ok": True}


def test_page_index_reuses_persisted_counts_until_file_changes(
    library: Path, tmp_path: Path
) -> None:
    state = tmp_path / "state"
    with TestClient(create_app(library, state)) as test_client:
        assert test_client.get("/api/pages").json()["counts"]["sub/a.pdf"] == 3

    index_file = state / "pages.json"
    data = json.loads(index_file.read_text(encoding="utf-8"))
    data["books"]["sub/a.pdf"]["pages"] = 42
    index_file.write_text(json.dumps(data), encoding="utf-8")

    with TestClient(create_app(library, state)) as test_client:
        assert test_client.get("/api/pages").json()["counts"]["sub/a.pdf"] == 42

    pdf = library / "sub" / "a.pdf"
    stat = pdf.stat()
    os.utime(pdf, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))

    with TestClient(create_app(library, state)) as test_client:
        assert test_client.get("/api/pages").json()["counts"]["sub/a.pdf"] == 3


def test_markdown_cache_invalidates_when_file_changes(client: Client, library: Path) -> None:
    test_client, _state = client
    params = {"path": "note.md"}
    assert '">Title</h1>' in test_client.get("/api/book/markdown", params=params).json()["html"]
    (library / "note.md").write_text("# Changed\n", encoding="utf-8")
    body = test_client.get("/api/book/markdown", params=params).json()
    assert '">Changed</h1>' in body["html"]
    assert body["title"] == "Changed"


def test_page_words_returns_text_layer(library: Path) -> None:
    layer = PdfCache().page_words(library / "sub" / "a.pdf", 1)
    width = layer["width"]
    height = layer["height"]
    words = layer["words"]
    assert isinstance(width, (int, float)) and width > 0
    assert isinstance(height, (int, float)) and height > 0
    assert isinstance(words, list)
    assert any(isinstance(word, dict) and word.get("t") == "hello-search-needle" for word in words)


def test_notepad_groups_notes_and_export(client: Client) -> None:
    test_client, _state = client
    group = test_client.post("/api/notepad/groups", json={"name": "Memory"}).json()
    assert group["name"] == "Memory"
    note = test_client.post(
        "/api/notepad/notes",
        json={
            "book": "sub/a.pdf",
            "kind": "pdf",
            "quote": "hello-search-needle",
            "page": 1,
            "group": group["id"],
            "word_start": 0,
            "word_end": 0,
            "section": "Intro",
            "comment": "core idea",
        },
    ).json()
    assert note["char_start"] == 0
    assert note["char_end"] == len("hello-search-needle")
    snapshot = test_client.get("/api/notepad").json()
    assert [entry["id"] for entry in snapshot["notes"]] == [note["id"]]

    patched = test_client.patch(
        f"/api/notepad/notes/{note['id']}", json={"comment": "revised"}
    ).json()
    assert patched["comment"] == "revised"

    export = test_client.get("/api/notepad/export", params={"format": "markdown"}).text
    assert "## Memory" in export
    assert "### sub/a.pdf · p.1" in export
    assert "§Intro" in export
    assert "¶1" in export
    assert "> hello-search-needle" in export
    assert "revised" in export
    assert "source: `sub/a.pdf#p1`" in export

    removed = test_client.delete(f"/api/notepad/groups/{group['id']}").json()
    assert removed == {"removed_notes": 1}
    assert test_client.get("/api/notepad").json()["notes"] == []


def test_markdown_note_gets_line_locator(client: Client) -> None:
    test_client, _state = client
    note = test_client.post(
        "/api/notepad/notes",
        json={"book": "note.md", "kind": "md", "quote": "see a", "section": "Title"},
    ).json()
    assert (note["line_start"], note["line_end"]) == (3, 3)


def test_notepad_rejects_unknown_group_and_invalid_input(client: Client) -> None:
    test_client, _state = client
    unknown = test_client.post(
        "/api/notepad/notes",
        json={"book": "note.md", "kind": "md", "quote": "Title", "group": "missing"},
    )
    assert unknown.status_code == 400
    bad_scroll = test_client.post("/api/progress", json={"path": "note.md", "scroll": 1.5})
    assert bad_scroll.status_code == 400


def test_section_index_uses_cached_tree(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    state.mkdir()
    path = library / "sub" / "a.pdf"
    stat = path.stat()
    cache = {
        "version": 1,
        "books": {
            "sub/a.pdf": {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": [
                    {"title": "Intro", "start_page": 1, "end_page": 3},
                    {"title": "Detail", "start_page": 2, "end_page": 3},
                ],
            }
        },
    }
    (state / "sections.json").write_text(json.dumps(cache), encoding="utf-8")
    index = SectionIndex(state)
    assert index.section_for_page("sub/a.pdf", path, 1) == "Intro"
    assert index.section_for_page("sub/a.pdf", path, 2) == "Detail"


def test_elastic_search_maps_hits_and_filters(tmp_path: Path) -> None:
    calls: dict[str, object] = {}

    class FakeClient:
        def options(self, **_kwargs: object) -> Self:
            return self

        def info(self) -> dict[str, object]:
            return {"version": {"number": "9.5.5"}}

        def search(self, **kwargs: object) -> dict[str, object]:
            calls.update(kwargs)
            return {
                "hits": {
                    "hits": [
                        {
                            "_source": {
                                "book": "a.pdf",
                                "kind": "pdf",
                                "page": 12,
                                "section": "Intro",
                                "text": "full text",
                            },
                            "highlight": {"text": ["<em>hit</em> snippet"]},
                        }
                    ]
                }
            }

        def count(self, **_kwargs: object) -> dict[str, int]:
            return {"count": 1}

    elastic = ElasticSearch(
        "http://localhost:9200",
        "test-index",
        PdfCache(),
        SectionIndex(tmp_path),
        tmp_path,
        client=cast(Elasticsearch, FakeClient()),
    )
    hits = elastic.search("metah", limit=5, book="a.pdf")
    assert hits == [
        {
            "book": "a.pdf",
            "kind": "pdf",
            "page": 12,
            "line": None,
            "line_end": None,
            "section": "Intro",
            "snippet": "<em>hit</em> snippet",
        }
    ]
    query = cast(dict[str, object], calls["query"])
    assert query["bool"] == {
        "must": [
            {
                "multi_match": {
                    "query": "metah",
                    "fields": ["text", "section^2"],
                    "type": "best_fields",
                }
            }
        ],
        "filter": [{"term": {"book": "a.pdf"}}],
    }
    assert calls["index"] == "test-index"


def test_elastic_requires_existing_index(tmp_path: Path) -> None:
    class MissingIndex:
        def exists(self, **_kwargs: object) -> bool:
            return False

    class IndexlessClient:
        indices = MissingIndex()

        def options(self, **_kwargs: object) -> Self:
            return self

        def info(self) -> dict[str, object]:
            return {"version": {"number": "9.5.5"}}

    elastic = ElasticSearch(
        "http://localhost:9200",
        "missing",
        PdfCache(),
        SectionIndex(tmp_path),
        tmp_path,
        client=cast(Elasticsearch, IndexlessClient()),
    )
    assert elastic.reachable() is True
    assert elastic.available() is False


def test_library_search_without_elastic_uses_tree_when_available(
    library: Path, tmp_path: Path
) -> None:
    tree = Searcher(Library(library), PdfCache(), SectionIndex(tmp_path), None, "pageindex")
    assert tree.backend() == "pageindex"
    with pytest.raises(SearchUnavailable):
        tree.library_wide("title", 10)

    strict = Searcher(Library(library), PdfCache(), SectionIndex(tmp_path), None, "local")
    assert strict.backend() == "local"
    local_hits = strict.library_wide("title", 10)
    assert [(hit["book"], hit["line"]) for hit in local_hits] == [("note.md", 1)]


def test_find_book_rejects_symlink_escape(library: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside.pdf"
    outside.write_bytes((library / "sub" / "a.pdf").read_bytes())
    link = library / "escape.pdf"
    link.symlink_to(outside)
    catalogue = Library(library)
    assert catalogue.find_book("escape.pdf") is None
    assert catalogue.find_book("sub/a.pdf") == (library / "sub" / "a.pdf").resolve()


def test_pageindex_tree_search_uses_cached_sections(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    state.mkdir()
    path = library / "sub" / "a.pdf"
    stat = path.stat()
    cache = {
        "version": 1,
        "books": {
            "sub/a.pdf": {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": [
                    {"title": "Retrieval", "start_page": 1, "end_page": 2},
                    {"title": "Vector similarity", "start_page": 2, "end_page": 3},
                ],
            }
        },
    }
    (state / "sections.json").write_text(json.dumps(cache), encoding="utf-8")
    searcher = Searcher(Library(library), PdfCache(), SectionIndex(state), None, "pageindex")
    assert searcher.backend() == "pageindex"
    hits, backend = searcher.in_book("sub/a.pdf", path, "retrieval", 10)
    assert backend == "pageindex"
    assert [(hit["section"], hit["page"]) for hit in hits] == [("Retrieval", 1)]
    library_hits = searcher.library_wide("vector", 10)
    assert [hit["section"] for hit in library_hits] == ["Vector similarity"]


def test_page_words_exposes_block_and_line_numbers(library: Path) -> None:
    layer = PdfCache().page_words(library / "sub" / "a.pdf", 1)
    words = layer["words"]
    assert isinstance(words, list) and words
    first = words[0]
    assert isinstance(first, dict)
    assert isinstance(first["b"], int) and first["b"] >= 1
    assert isinstance(first["l"], int) and first["l"] >= 1


def test_pdf_note_records_block_and_line(client: Client) -> None:
    test_client, _state = client
    note = test_client.post(
        "/api/notepad/notes",
        json={
            "book": "sub/a.pdf",
            "kind": "pdf",
            "quote": "hello-search-needle",
            "page": 1,
            "word_start": 0,
            "word_end": 0,
        },
    ).json()
    assert note["paragraph"] >= 1
    assert note["line_start"] >= 1
    export = test_client.get("/api/notepad/export", params={"format": "markdown"}).text
    assert f"¶{note['paragraph']}" in export
    assert f"lines {note['line_start']}" in export


def test_pdf_note_without_word_offsets_uses_page_text_and_cached_section(
    library: Path, tmp_path: Path
) -> None:
    state = tmp_path / "state"
    with TestClient(create_app(library, state)) as test_client:
        path = library / "sub" / "a.pdf"
        stat = path.stat()
        (state / "sections.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "books": {
                        "sub/a.pdf": {
                            "mtime": stat.st_mtime,
                            "size": stat.st_size,
                            "sections": [
                                {"title": "Intro", "start_page": 1, "end_page": 3, "depth": 0}
                            ],
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        response = test_client.post(
            "/api/notepad/notes",
            json={
                "book": "sub/a.pdf",
                "kind": "pdf",
                "page": 1,
                "quote": "hello-search-needle",
            },
        )

    assert response.status_code == 200, response.text
    note = response.json()
    assert note["page"] == 1
    assert note["section"] == "Intro"
    assert note["paragraph"] is None
    assert note["char_start"] is not None
    assert note["char_end"] == note["char_start"] + len("hello-search-needle")


def test_markdown_locator_keeps_intraword_underscores(client: Client) -> None:
    test_client, _state = client
    note = test_client.post(
        "/api/notepad/notes",
        json={"book": "note.md", "kind": "md", "quote": "snake_case names"},
    ).json()
    assert note["line_start"] is not None
    assert note["line_start"] >= 10


def test_markdown_blocks_have_line_anchors(client: Client) -> None:
    test_client, _state = client
    body = test_client.get("/api/book/markdown", params={"path": "note.md"}).json()["html"]
    assert 'id="L1"' in body
    assert 'id="L3"' in body


def test_api_pages_skips_symlink_escape(library: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside.pdf"
    outside.write_bytes((library / "sub" / "a.pdf").read_bytes())
    (library / "escape.pdf").symlink_to(outside)
    with TestClient(create_app(library, tmp_path / "state")) as test_client:
        counts = test_client.get("/api/pages").json()["counts"]
    assert "escape.pdf" not in counts


def test_tree_search_ignores_cached_books_outside_the_library(
    library: Path, tmp_path: Path
) -> None:
    state = tmp_path / "state"
    state.mkdir()
    path = library / "sub" / "a.pdf"
    stat = path.stat()
    cache = {
        "version": 1,
        "books": {
            "sub/a.pdf": {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": [{"title": "Retrieval", "start_page": 1, "end_page": 3}],
            },
            "ghost.pdf": {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": [{"title": "Retrieval strategies", "start_page": 1, "end_page": 3}],
            },
        },
    }
    (state / "sections.json").write_text(json.dumps(cache), encoding="utf-8")
    searcher = Searcher(Library(library), PdfCache(), SectionIndex(state), None, "pageindex")
    hits = searcher.library_wide("retrieval", 10)
    assert [hit["book"] for hit in hits] == ["sub/a.pdf"]


def test_bulk_indexing_errors_are_raised(tmp_path: Path) -> None:
    class FailingBulk:
        class indices:
            @staticmethod
            def exists(**_kwargs: object) -> bool:
                return True

            @staticmethod
            def delete(**_kwargs: object) -> dict[str, object]:
                return {}

            @staticmethod
            def create(**_kwargs: object) -> dict[str, object]:
                return {}

            @staticmethod
            def refresh(**_kwargs: object) -> dict[str, object]:
                return {}

        def options(self, **_kwargs: object) -> Self:
            return self

        def info(self) -> dict[str, object]:
            return {}

        def delete_by_query(self, **_kwargs: object) -> dict[str, int]:
            return {"deleted": 0}

        def bulk(self, **_kwargs: object) -> dict[str, object]:
            return {
                "errors": True,
                "items": [{"index": {"status": 400, "error": {"type": "mapper"}}}],
            }

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "equilibrium optimizer explanation text " * 5)
    path = tmp_path / "long.pdf"
    doc.save(path)
    doc.close()
    stat = path.stat()
    book = Book(rel="long.pdf", title="long", kind="pdf", size=stat.st_size, mtime=stat.st_mtime)

    elastic = ElasticSearch(
        "http://localhost:9200",
        "test",
        PdfCache(),
        SectionIndex(tmp_path),
        tmp_path,
        client=cast(Elasticsearch, FailingBulk()),
    )
    with pytest.raises(RuntimeError, match="bulk indexing failed"):
        elastic._index_book(book, path)


def test_library_uses_an_unambiguous_pdf_outline_title(client: Client, library: Path) -> None:
    test_client, _state = client
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "paper body")
    doc.set_toc([[1, "A Paper Title With No Metadata", 1]])
    doc.save(library / "paper.pdf")
    doc.close()

    books = _library_books(test_client)

    assert books["paper.pdf"]["title"] == "A Paper Title With No Metadata"
    detail = test_client.get("/api/book", params={"path": "paper.pdf"}).json()
    assert detail["title"] == "A Paper Title With No Metadata"


def test_numbered_outline_heading_is_not_used_as_a_title(client: Client, library: Path) -> None:
    test_client, _state = client
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "body")
    doc.set_toc([[1, "1 . Introduction", 1], [2, "1.1 Background", 1]])
    doc.save(library / "chapter.pdf")
    doc.close()

    books = _library_books(test_client)

    assert books["chapter.pdf"]["title"] == "chapter"


def test_raw_html_and_svg_are_attachments(client: Client, library: Path) -> None:
    (library / "sub" / "evil.html").write_text("<script>alert(1)</script>", encoding="utf-8")
    (library / "sub" / "drawing.svg").write_text("<svg onload=alert(1)></svg>", encoding="utf-8")
    test_client, _state = client

    for name in ("evil.html", "drawing.svg"):
        response = test_client.get(f"/raw/sub/{name}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["content-disposition"] == "attachment"
        assert response.headers["x-content-type-options"] == "nosniff"


def test_raw_pdf_stays_inline_for_the_viewer(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/raw/sub/a.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "content-disposition" not in response.headers
    assert response.headers["x-content-type-options"] == "nosniff"
