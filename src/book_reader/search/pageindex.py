"""PageIndex section-tree retrieval over page text (no external services)."""

from __future__ import annotations

import logging
import math
import threading
from collections import OrderedDict
from pathlib import Path
from typing import cast

from ..library.scan import Library
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from .text import query_terms, snippet_around, title_score
from .types import SearchHit

logger = logging.getLogger(__name__)


class PageIndexSearch:
    """Vectorless retrieval over PageIndex section trees plus page text.

    Section titles pick candidate regions (layout-derived, cached per file);
    page text inside those regions supplies the scored evidence. When no title
    matches, the document is scanned page by page, so recall never collapses
    to heading wording alone.
    """

    MAX_SCAN_PAGES = 240
    MAX_SECTION_SPAN = 40
    MAX_TERM_FREQUENCY = 5
    SNIPPET_RADIUS = 90
    CONTENT_SCORE_CAP = 6.0
    TITLE_START_BASE = 6.0
    TITLE_START_WEIGHT = 16.0
    TITLE_PAGE_BONUS = 2.0
    PHRASE_BONUS = 4.0
    SECTION_BONUS = 3.0
    DEPTH_WEIGHT = 0.02
    RESULT_CACHE_SIZE = 64

    def __init__(self, library: Library, sections: SectionIndex, pdf: PdfCache) -> None:
        self._library = library
        self._sections = sections
        self._pdf = pdf
        self._lock = threading.Lock()
        # An Ask answer asks several near-identical questions in a row; repeating a scan
        # costs the same 70ms. Keyed by the library's file versions and cached trees, so
        # an edited file or a new tree misses instead of answering from stale text.
        self._results: OrderedDict[tuple[object, ...], list[SearchHit]] = OrderedDict()

    def _signature(self) -> tuple[object, ...]:
        books = self._library.scan()
        return (
            tuple((book.rel, book.mtime, book.size) for book in books),
            tuple(self._sections.cached_books()),
        )

    def _cached(self, key: tuple[object, ...]) -> list[SearchHit] | None:
        with self._lock:
            hits = self._results.get(key)
            if hits is None:
                return None
            self._results.move_to_end(key)
        return [cast(SearchHit, dict(hit)) for hit in hits]

    def _remember(self, key: tuple[object, ...], hits: list[SearchHit]) -> None:
        with self._lock:
            self._results[key] = [cast(SearchHit, dict(hit)) for hit in hits]
            while len(self._results) > self.RESULT_CACHE_SIZE:
                self._results.popitem(last=False)

    def search(self, query: str, *, limit: int = 50, book: str | None = None) -> list[SearchHit]:
        terms = query_terms(query)
        if not terms or not self._sections.available():
            return []
        key = (" ".join(query.casefold().split()), limit, book, self._signature())
        remembered = self._cached(key)
        if remembered is not None:
            return remembered
        scored: list[tuple[int, SearchHit]] = []
        for rel, path in self._books(book):
            scored.extend(self._search_book(rel, path, terms, limit))
            if len(scored) >= limit * 3:
                break
        scored.sort(key=lambda item: (-item[0], item[1]["book"], item[1]["page"] or 0))
        hits = [hit for _score, hit in scored[:limit]]
        self._remember(key, hits)
        return hits

    def _candidate_pages(self, total: int, title_pages: set[int]) -> list[int]:
        if total <= self.MAX_SCAN_PAGES:
            return list(range(1, total + 1))
        ranked = sorted(number for number in title_pages if 1 <= number <= total)
        budget = max(0, self.MAX_SCAN_PAGES - len(ranked))
        extra = [number for number in range(1, total + 1) if number not in title_pages][:budget]
        return sorted(set(ranked + extra))[: self.MAX_SCAN_PAGES]

    def _page_texts(self, path: Path, page_numbers: list[int]) -> dict[int, str]:
        texts: dict[int, str] = {}
        for number in page_numbers:
            try:
                texts[number] = self._pdf.page_text_normalized(path, number)
            except Exception:
                continue
        return texts

    def _books(self, book: str | None) -> list[tuple[str, Path]]:
        if book is not None:
            path = self._library.find_book(book)
            if path is None:
                return []
            if not self._sections.cached(book):
                self._sections.sections(book, path)
            return [(book, path)]
        present = {entry.rel for entry in self._library.scan()}
        books: list[tuple[str, Path]] = []
        for rel in self._sections.cached_books():
            if rel not in present:
                continue
            path = self._library.find_book(rel)
            if path is not None:
                books.append((rel, path))
        return books

    def _search_book(
        self, rel: str, path: Path, terms: list[str], limit: int
    ) -> list[tuple[int, SearchHit]]:
        sections = self._sections.cached(rel)
        title_matches = [section for section in sections if title_score(section["title"], terms)]
        try:
            total = self._pdf.page_count(path)
        except Exception:
            return []

        title_starts: dict[int, tuple[str, float]] = {}
        title_pages: set[int] = set()
        for match in title_matches:
            strength = title_score(match["title"], terms) / max(1, len(terms))
            depth = float(match.get("depth", 0))
            candidate = (match["title"], strength + depth * self.DEPTH_WEIGHT)
            previous = title_starts.get(match["start_page"])
            if previous is None or candidate[1] > previous[1]:
                title_starts[match["start_page"]] = candidate
            title_pages.update(
                range(
                    match["start_page"],
                    min(match["end_page"], match["start_page"] + self.MAX_SECTION_SPAN) + 1,
                )
            )
        texts = self._page_texts(path, self._candidate_pages(total, title_pages))
        folded_pages = {number: text.casefold() for number, text in texts.items()}
        scanned = max(1, len(folded_pages))
        document_frequency = {
            term: sum(1 for folded in folded_pages.values() if term in folded) for term in terms
        }

        scored: list[tuple[int, int, str, str]] = []
        for number, text in texts.items():
            folded = folded_pages[number]
            content = 0.0
            for term in terms:
                frequency = min(folded.count(term), self.MAX_TERM_FREQUENCY)
                if frequency:
                    content += frequency * (
                        1.0 + math.log(scanned / max(1, document_frequency[term]))
                    )
            title_entry = title_starts.get(number)
            if not content and title_entry is None:
                continue
            score = min(content, self.CONTENT_SCORE_CAP)
            if title_entry is not None:
                score += self.TITLE_START_BASE + self.TITLE_START_WEIGHT * title_entry[1]
            if number in title_pages:
                score += self.TITLE_PAGE_BONUS
            if len(terms) > 1 and " ".join(terms) in folded:
                score += self.PHRASE_BONUS
            section = (
                title_entry[0]
                if title_entry is not None
                else self._sections.section_for_page(rel, path, number)
            )
            if section and title_score(section, terms):
                score += self.SECTION_BONUS
            if any(term in folded for term in terms):
                snippet = snippet_around(text, terms, self.SNIPPET_RADIUS)
            else:
                snippet = f"pp. {number} · {section}"
            scored.append((round(score), number, section, snippet))
        scored.sort(key=lambda row: (-row[0], row[1]))
        return [
            (
                score,
                SearchHit(
                    book=rel,
                    kind="pdf",
                    page=number,
                    line=None,
                    line_end=None,
                    section=section,
                    snippet=snippet,
                ),
            )
            for score, number, section, snippet in scored[:limit]
        ]
