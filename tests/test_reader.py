import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Self, cast

import pymupdf
import pytest
from elasticsearch import Elasticsearch
from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.library import Library
from book_reader.mdrender import render_markdown
from book_reader.pdf import PdfCache
from book_reader.search import ElasticSearch, Searcher, SearchUnavailable
from book_reader.sections import SectionIndex

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
Client = tuple[TestClient, Path]


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "library"
    (root / "sub").mkdir(parents=True)
    (root / ".hidden").mkdir()

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "hello-search-needle")
    doc.new_page()
    doc.new_page()
    doc.save(root / "sub" / "a.pdf")
    doc.close()

    (root / "note.md").write_text(
        "# Title\n\nsee [a](sub/a.pdf)\n\n![pic](sub/pic%20one.png)\n\n```python\nprint(1)\n```\n",
        encoding="utf-8",
    )
    (root / "sub" / "pic one.png").write_bytes(PNG_MAGIC + b"\x00")
    (root / ".hidden" / "secret.md").write_text("# secret", encoding="utf-8")
    (root / "img.bin").write_bytes(b"\x00\x01")
    return root


@pytest.fixture
def client(library: Path, tmp_path: Path) -> Iterator[Client]:
    state = tmp_path / "state"
    with TestClient(create_app(library, state)) as test_client:
        yield test_client, state


def test_index_lists_books_and_skips_hidden_dirs(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/")
    assert response.status_code == 200
    body = response.text
    assert "/book/sub/a.pdf" in body
    assert "/book/note.md" in body
    assert "secret" not in body


def test_page_png_renders_and_rejects_out_of_range(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/page.png", params={"path": "sub/a.pdf", "page": 1, "zoom": 1.0})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    body = response.content
    assert body.startswith(PNG_MAGIC)
    width = int.from_bytes(body[16:20], "big")
    height = int.from_bytes(body[20:24], "big")
    assert width > 0 and height > 0
    assert test_client.get("/page.png", params={"path": "sub/a.pdf", "page": 99}).status_code == 400


def test_path_traversal_is_rejected(client: Client) -> None:
    test_client, _state = client
    assert (
        test_client.get("/page.png", params={"path": "../outside.pdf", "page": 1}).status_code
        == 400
    )
    assert test_client.get("/book/..%2F..%2Fetc%2Fpasswd").status_code == 400


def test_markdown_book_renders_links_and_code(client: Client) -> None:
    test_client, _state = client
    response = test_client.get("/book/note.md")
    assert response.status_code == 200
    body = response.text
    assert "<h1>Title</h1>" in body
    assert "/book/sub/a.pdf" in body
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
    assert 'data-page="2"' in test_client.get("/book/sub/a.pdf").text
    assert "Continue reading" in test_client.get("/").text

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
    assert "<h1>Title</h1>" in test_client.get("/book/note.md").text
    (library / "note.md").write_text("# Changed\n", encoding="utf-8")
    assert "<h1>Changed</h1>" in test_client.get("/book/note.md").text


def test_text_layer_returns_words(client: Client) -> None:
    test_client, _state = client
    layer = test_client.get("/api/text", params={"path": "sub/a.pdf", "page": 1}).json()
    assert layer["width"] > 0 and layer["height"] > 0
    assert any(word["t"] == "hello-search-needle" for word in layer["words"])


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
    assert "sub/a.pdf · p.1 · §Intro" in export
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


def test_library_search_without_elastic_uses_tree_when_available(
    library: Path, tmp_path: Path
) -> None:
    tree = Searcher(Library(library), PdfCache(), SectionIndex(tmp_path), None, "pageindex")
    assert tree.backend() == "pageindex"
    assert tree.library_wide("title", 10) == []

    strict = Searcher(Library(library), PdfCache(), SectionIndex(tmp_path), None, "local")
    assert strict.backend() == "local"
    with pytest.raises(SearchUnavailable):
        strict.library_wide("title", 10)


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
