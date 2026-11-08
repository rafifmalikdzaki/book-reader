import json
from pathlib import Path
from typing import Self

import pymupdf
import pytest

from book_reader.library import Library
from book_reader.pdf import PdfCache
from book_reader.search import PageIndexSearch, Searcher
from book_reader.sections import SectionIndex


def build_pdf(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    texts = [
        "Alpha methods overview of alpha approaches",
        "Alpha results gamma measurement",
        "Beta systems delta control",
        "Gamma appendix epsilon notes",
    ]
    for text in texts:
        doc.new_page().insert_text((72, 72), text)
    path = root / "sections.pdf"
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def tree(tmp_path: Path) -> tuple[PageIndexSearch, Path]:
    root = tmp_path / "library"
    path = build_pdf(root)
    state = tmp_path / "state"
    state.mkdir()
    stat = path.stat()
    cache = {
        "version": 1,
        "books": {
            "sections.pdf": {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": [
                    {"title": "Alpha", "start_page": 1, "end_page": 2},
                    {"title": "Beta systems", "start_page": 3, "end_page": 3},
                    {"title": "Gamma", "start_page": 4, "end_page": 4},
                ],
            }
        },
    }
    (state / "sections.json").write_text(json.dumps(cache), encoding="utf-8")
    index = SectionIndex(state)
    searcher = PageIndexSearch(Library(root), index, PdfCache())
    return searcher, path


def test_hybrid_finds_page_text_without_title_match(
    tree: tuple[PageIndexSearch, Path],
) -> None:
    searcher, _path = tree
    hits = searcher.search("delta", limit=5, book="sections.pdf")
    assert hits
    assert hits[0]["page"] == 3
    assert hits[0]["section"] == "Beta systems"
    assert "delta" in str(hits[0]["snippet"]).casefold()


def test_title_match_seeds_candidate_pages(tree: tuple[PageIndexSearch, Path]) -> None:
    searcher, _path = tree
    hits = searcher.search("gamma", limit=5, book="sections.pdf")
    pages = [hit["page"] for hit in hits]
    assert 4 in pages
    gamma = next(hit for hit in hits if hit["page"] == 4)
    assert gamma["section"] == "Gamma"


def test_unmatched_query_scans_all_pages(tree: tuple[PageIndexSearch, Path]) -> None:
    searcher, _path = tree
    hits = searcher.search("overview", limit=5, book="sections.pdf")
    assert hits
    assert hits[0]["page"] == 1
    assert hits[0]["section"] == "Alpha"


def test_empty_query_returns_nothing(tree: tuple[PageIndexSearch, Path]) -> None:
    searcher, _path = tree
    assert searcher.search("   ", limit=5, book="sections.pdf") == []


def test_searcher_reports_pageindex_backend(tmp_path: Path) -> None:
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
                    "sections.pdf": {
                        "mtime": stat.st_mtime,
                        "size": stat.st_size,
                        "sections": [{"title": "Alpha", "start_page": 1, "end_page": 2}],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    searcher = Searcher(Library(root), PdfCache(), SectionIndex(state), None, "pageindex")
    hits, backend = searcher.in_book("sections.pdf", path, "measurement", 5)
    assert backend == "pageindex"
    assert any(hit["page"] == 2 for hit in hits)


def test_in_book_merges_section_hits_ahead_of_elastic(tmp_path: Path) -> None:
    from typing import cast

    from elasticsearch import Elasticsearch

    from book_reader.search import ElasticSearch

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
                    "sections.pdf": {
                        "mtime": stat.st_mtime,
                        "size": stat.st_size,
                        "sections": [{"title": "Beta systems", "start_page": 3, "end_page": 3}],
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    class ExistingIndex:
        def exists(self, **_kwargs: object) -> bool:
            return True

    class FakeClient:
        indices = ExistingIndex()

        def options(self, **_kwargs: object) -> Self:
            return self

        def info(self) -> dict[str, object]:
            return {"version": {"number": "9.5.5"}}

        def search(self, **_kwargs: object) -> dict[str, object]:
            return {
                "hits": {
                    "hits": [
                        {
                            "_source": {
                                "book": "sections.pdf",
                                "kind": "pdf",
                                "page": 4,
                                "section": "Gamma",
                                "text": "delta",
                            }
                        }
                    ]
                }
            }

    pdf = PdfCache()
    sections = SectionIndex(state)
    elastic = ElasticSearch(
        "http://localhost:9200",
        "test",
        pdf,
        sections,
        state,
        client=cast(Elasticsearch, FakeClient()),
    )
    searcher = Searcher(Library(root), pdf, sections, elastic, "auto")
    hits, backend = searcher.in_book("sections.pdf", path, "delta", 5)
    assert backend == "hybrid"
    assert hits[0]["page"] == 3
    assert [hit["page"] for hit in hits].count(4) == 1
