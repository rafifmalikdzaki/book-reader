"""Searcher: picks Elasticsearch, PageIndex, or an in-process scan per query."""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

from ..library.models import Book
from ..library.scan import Library
from ..reading.markdown import search_markdown
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from .elastic import ElasticSearch
from .pageindex import PageIndexSearch
from .types import SearchHit, SearchUnavailable

logger = logging.getLogger(__name__)


SEARCH_MODES = {"auto", "elastic", "pageindex", "local"}


class Searcher:
    """In-book and library-wide search across the configured backends."""

    def __init__(
        self,
        library: Library,
        pdf: PdfCache,
        sections: SectionIndex,
        elastic: ElasticSearch | None,
        mode: str = "auto",
    ) -> None:
        self._library = library
        self._pdf = pdf
        self._sections = sections
        self._elastic = elastic
        self._mode = mode if mode in SEARCH_MODES else "auto"
        self._tree = PageIndexSearch(library, sections, pdf)

    def _search_elastic(
        self, query: str, *, limit: int, book: str | None = None
    ) -> list[SearchHit] | None:
        """Elasticsearch hits, or ``None`` when the backend cannot answer."""
        if not self._elastic_ready() or self._elastic is None:
            return None
        try:
            return self._elastic.search(query, limit=limit, book=book)
        except Exception as exc:
            logger.warning("elasticsearch search failed: %s", exc)
            return None

    def _elastic_ready(self) -> bool:
        return (
            self._mode in {"auto", "elastic"}
            and self._elastic is not None
            and self._elastic.available()
        )

    def backend(self) -> str:
        if self._elastic_ready():
            return "elasticsearch"
        if self._mode in {"auto", "pageindex"} and self._sections.available():
            return "pageindex"
        return "local"

    def in_book(
        self, rel: str, target: Path, query: str, limit: int
    ) -> tuple[list[SearchHit], str]:
        if not query.strip():
            return [], "local"
        elastic_hits = self._search_elastic(query, limit=limit, book=rel)
        tree_hits: list[SearchHit] = []
        wants_tree = target.suffix.lower() == ".pdf" and self._mode in {"auto", "pageindex"}
        if wants_tree and (self._mode == "pageindex" or bool(self._sections.cached(rel))):
            tree_hits = self._tree.search(query, limit=limit, book=rel)
        if elastic_hits and tree_hits:
            seen_pages = {hit["page"] for hit in tree_hits}
            merged = tree_hits + [hit for hit in elastic_hits if hit["page"] not in seen_pages]
            return merged[:limit], "hybrid"
        if elastic_hits:
            return elastic_hits, "elasticsearch"
        if tree_hits:
            return tree_hits, "pageindex"
        if target.suffix.lower() == ".pdf" and self._mode in {"auto", "pageindex"}:
            hits = self._tree.search(query, limit=limit, book=rel)
            if hits:
                return hits, "pageindex"
        if target.suffix.lower() == ".md":
            return [
                SearchHit(
                    book=rel,
                    kind="md",
                    page=None,
                    line=int(str(hit["line"])),
                    line_end=int(str(hit["line"])),
                    section="",
                    snippet=str(hit["snippet"]),
                )
                for hit in search_markdown(target, query, limit)
            ], "local"
        return [
            SearchHit(
                book=rel,
                kind="pdf",
                page=int(str(hit["page"])),
                line=None,
                line_end=None,
                section=self._sections.section_for_page(rel, target, int(str(hit["page"]))),
                snippet=str(hit["snippet"]),
            )
            for hit in self._pdf.search(target, query, limit)
        ], "local"

    def library_wide(self, query: str, limit: int) -> list[SearchHit]:
        elastic_hits = self._search_elastic(query, limit=limit)
        if elastic_hits is not None:
            return elastic_hits
        if self._mode in {"auto", "pageindex"} and self._sections.cached_books():
            return self._tree.search(query, limit=limit)
        if self._mode == "pageindex":
            raise SearchUnavailable(
                "no cached PageIndex section trees yet; open a book to build one, "
                "or configure Elasticsearch"
            )
        return self._local_library(query, limit)

    def _local_library(self, query: str, limit: int) -> list[SearchHit]:
        """Scan candidate books and text when no full-text index is available yet."""
        needle = query.strip()
        if not needle:
            return []
        books = self._library.scan()
        if not books:
            return []

        # Tokenize query to identify candidate books by title / relative path
        query_words = [w.casefold() for w in re.findall(r"\w+", needle) if len(w) > 1]
        stop_words = {
            "in",
            "of",
            "the",
            "a",
            "an",
            "and",
            "or",
            "for",
            "to",
            "with",
            "on",
            "at",
            "by",
            "from",
            "regarding",
            "about",
            "me",
            "books",
            "book",
            "recommend",
        }
        meaningful_words = [w for w in query_words if w not in stop_words]
        match_words = meaningful_words or query_words

        def score_book(book: Book) -> int:
            rel_lower = book.rel.casefold()
            score = 0
            if needle.casefold() in rel_lower:
                score += 100
            for w in match_words:
                if w in rel_lower:
                    score += 20
            if book.kind == "md":
                score += 5
            return score

        scored_books = [(score_book(b), b) for b in books]
        scored_books.sort(key=lambda item: (-item[0], item[1].rel.casefold()))

        hits: list[SearchHit] = []
        candidate_matches: list[SearchHit] = []
        start_time = time.monotonic()
        MAX_SEARCH_SECONDS = 2.0
        MAX_CHECKED_BOOKS = 8

        checked = 0
        for score, book in scored_books:
            if len(hits) >= limit or time.monotonic() - start_time > MAX_SEARCH_SECONDS:
                break
            if checked >= MAX_CHECKED_BOOKS and len(hits) > 0:
                break

            target = self._library.find_book(book.rel)
            if target is None:
                continue

            checked += 1
            remaining = max(1, limit - len(hits))

            if book.kind == "md":
                found = search_markdown(target, needle, remaining)
                for hit in found:
                    hits.append(
                        SearchHit(
                            book=book.rel,
                            kind="md",
                            page=None,
                            line=int(str(hit["line"])),
                            line_end=int(str(hit["line"])),
                            section="",
                            snippet=str(hit["snippet"]),
                        )
                    )
            else:
                found = self._pdf.search(target, needle, remaining)
                for hit in found:
                    hits.append(
                        SearchHit(
                            book=book.rel,
                            kind="pdf",
                            page=int(str(hit["page"])),
                            line=None,
                            line_end=None,
                            section=self._sections.cached_section_for_page(
                                book.rel, int(str(hit["page"]))
                            ),
                            snippet=str(hit["snippet"]),
                        )
                    )
                if not found and score >= 20:
                    candidate_matches.append(
                        SearchHit(
                            book=book.rel,
                            kind="pdf",
                            page=1,
                            line=None,
                            line_end=None,
                            section=self._sections.cached_section_for_page(book.rel, 1),
                            snippet=f"Title match: {book.title} (candidate book for '{needle}')",
                        )
                    )

        if len(hits) < limit and candidate_matches:
            seen_books = {hit["book"] for hit in hits}
            for candidate in candidate_matches:
                if candidate["book"] not in seen_books:
                    hits.append(candidate)
                    seen_books.add(candidate["book"])
                    if len(hits) >= limit:
                        break

        return hits[:limit]
