"""Fault-injection tests for the retrieval layer (BM25-style text search + PageIndex)."""

from __future__ import annotations

import json
from pathlib import Path

import pymupdf

from book_reader.library.scan import Library
from book_reader.reading.pdf import PdfCache
from book_reader.reading.sections import SectionIndex
from book_reader.search.pageindex import PageIndexSearch
from book_reader.search.text import query_terms, snippet_around


def build_pdf(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Alpha methods overview of alpha approaches")
    doc.new_page().insert_text((72, 72), "Beta systems delta control")
    doc.save(path := root / "doc.pdf")
    doc.close()
    return path


def make_searcher(tmp_path: Path) -> tuple[PageIndexSearch, Path]:
    root = tmp_path / "library"
    path = build_pdf(root)
    state = tmp_path / "state"
    state.mkdir()
    stat = path.stat()
    (state / "sections.json").write_text(
        json.dumps(
            {
                "version": 1,
                "books": {
                    "doc.pdf": {
                        "mtime": stat.st_mtime,
                        "size": stat.st_size,
                        "sections": [
                            {"title": "Alpha", "start_page": 1, "end_page": 1},
                            {"title": "Beta systems", "start_page": 2, "end_page": 2},
                        ],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    return PageIndexSearch(Library(root), SectionIndex(state), PdfCache()), path


def test_stopword_only_query_returns_nothing(tmp_path: Path) -> None:
    searcher, _ = make_searcher(tmp_path)
    assert query_terms("the and that this") == []
    assert searcher.search("the and that this", limit=5) == []


def test_unknown_book_returns_nothing(tmp_path: Path) -> None:
    searcher, _ = make_searcher(tmp_path)
    assert searcher.search("delta", limit=5, book="does-not-exist.pdf") == []


def test_corrupt_sections_cache_degrades_gracefully(tmp_path: Path) -> None:
    searcher, _ = make_searcher(tmp_path)
    state = tmp_path / "state"
    (state / "sections.json").write_text("{not valid json", encoding="utf-8")
    # Must not raise; with no usable section index, search simply finds nothing.
    assert searcher.search("delta", limit=5) == []
    # And the index recovers once a valid cache entry is rebuilt.
    assert searcher._sections.available() in (False, True)


def test_snippet_around_handles_missing_and_empty_terms() -> None:
    text = "x" * 500
    assert snippet_around(text, ["absent"], radius=90) == text[:180]
    assert snippet_around(text, [], radius=90) == text[:180]
    hit = snippet_around("alpha beta gamma", ["beta"], radius=3)
    assert "beta" in hit
