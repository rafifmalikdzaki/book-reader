"""Search backends: Elasticsearch when configured, in-process text scan otherwise."""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import TypedDict

from elasticsearch import Elasticsearch

from .library import Book, Library
from .mdrender import search_markdown
from .pdf import PdfCache
from .sections import SectionIndex

logger = logging.getLogger(__name__)

CHUNK_CHARS = 4000
BULK_BATCH = 500
MAPPING_VERSION = 1


class SearchHit(TypedDict):
    book: str
    kind: str
    page: int | None
    line: int | None
    line_end: int | None
    section: str
    snippet: str


class SearchUnavailable(RuntimeError):
    """Raised when a search needs Elasticsearch and it is not reachable."""


class RebuildJob:
    """Tracks a library index rebuild running in a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.running = False
        self.stats: dict[str, int] | None = None
        self.error: str | None = None
        self.started_at: float | None = None
        self.finished_at: float | None = None

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "running": self.running,
                "stats": dict(self.stats) if self.stats is not None else None,
                "error": self.error,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
            }

    def start(self, task: Callable[[], dict[str, int]]) -> bool:
        with self._lock:
            if self.running:
                return False
            self.running = True
            self.stats = None
            self.error = None
            self.started_at = time.time()
            self.finished_at = None
        thread = threading.Thread(target=self._run, args=(task,), daemon=True)
        thread.start()
        return True

    def _run(self, task: Callable[[], dict[str, int]]) -> None:
        try:
            stats = task()
        except Exception as exc:
            logger.warning("index rebuild failed: %s", exc)
            with self._lock:
                self.error = str(exc)
        else:
            with self._lock:
                self.stats = stats
        finally:
            with self._lock:
                self.running = False
                self.finished_at = time.time()


class ElasticSearch:
    """Chunk index in Elasticsearch: one document per PDF page or Markdown block."""

    def __init__(
        self,
        url: str,
        index: str,
        pdf: PdfCache,
        sections: SectionIndex,
        state_dir: Path,
        client: Elasticsearch | None = None,
    ) -> None:
        self.url = url
        self.index = index
        self._pdf = pdf
        self._sections = sections
        self.state_path = Path(state_dir) / "search_index.json"
        self._lock = threading.Lock()
        self._client = client or Elasticsearch(url)
        self._state: dict[str, dict[str, object]] | None = None
        self.rebuild_job = RebuildJob()

    def reachable(self) -> bool:
        """Whether the cluster answers, regardless of index existence."""
        try:
            self._client.options(request_timeout=1).info()
        except Exception:
            return False
        return True

    def available(self) -> bool:
        """Whether search can run: cluster reachable and index present."""
        if not self.reachable():
            return False
        try:
            return bool(self._client.indices.exists(index=self.index))
        except Exception:
            return False

    def chunk_count(self) -> int | None:
        try:
            return int(self._client.count(index=self.index)["count"])
        except Exception:
            return None

    def ensure_index(self, *, recreate: bool = False) -> None:
        if recreate and self._client.indices.exists(index=self.index):
            self._client.indices.delete(index=self.index)
        if self._client.indices.exists(index=self.index):
            return
        self._client.indices.create(
            index=self.index,
            mappings={
                "properties": {
                    "book": {"type": "keyword"},
                    "kind": {"type": "keyword"},
                    "page": {"type": "integer"},
                    "line": {"type": "integer"},
                    "line_end": {"type": "integer"},
                    "section": {"type": "text", "fields": {"raw": {"type": "keyword"}}},
                    "text": {"type": "text"},
                    "mapping_version": {"type": "integer"},
                }
            },
            settings={"number_of_shards": 1, "number_of_replicas": 0},
        )

    def _load_state(self) -> dict[str, dict[str, object]]:
        with self._lock:
            if self._state is None:
                try:
                    raw: object = json.loads(self.state_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    raw = {}
                books = raw.get("books") if isinstance(raw, dict) else None
                self._state = (
                    {str(rel): entry for rel, entry in books.items() if isinstance(entry, dict)}
                    if isinstance(books, dict)
                    else {}
                )
            return self._state

    def _save_state(self) -> None:
        with self._lock:
            payload = {"version": 1, "books": self._state or {}}
            try:
                self.state_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.state_path.with_name(self.state_path.name + ".tmp")
                tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
                os.replace(tmp, self.state_path)
            except OSError as exc:
                logger.warning("cannot persist search index state: %s", exc)

    def rebuild(self, library: Library, *, force: bool = False) -> dict[str, int]:
        self.ensure_index(recreate=force)
        state = self._load_state()
        indexed = skipped = chunks = 0
        for book in library.scan():
            path = library.find_book(book.rel)
            if path is None:
                logger.warning("skipping %s: not a readable library file", book.rel)
                skipped += 1
                continue
            entry = state.get(book.rel)
            if (
                not force
                and entry is not None
                and entry.get("mtime") == book.mtime
                and entry.get("size") == book.size
            ):
                skipped += 1
                continue
            indexed_chunks = self._index_book(book, path)
            indexed += 1
            chunks += indexed_chunks
            logger.info("indexed %s (%d chunks)", book.rel, indexed_chunks)
            state[book.rel] = {
                "mtime": book.mtime,
                "size": book.size,
                "chunks": indexed_chunks,
            }
            self._save_state()
        current = {book.rel for book in library.scan()}
        removed = [rel for rel in state if rel not in current]
        for rel in removed:
            del state[rel]
        if removed:
            logger.info("pruned %d books no longer in the library", len(removed))
            self._save_state()
        self._prune(current)
        try:
            self._client.indices.refresh(index=self.index)
        except Exception as exc:
            logger.warning("cannot refresh %s: %s", self.index, exc)
        return {"indexed": indexed, "skipped": skipped, "chunks": chunks}

    def _prune(self, current: set[str]) -> None:
        """Remove documents for books that are no longer under the library root."""
        query: dict[str, object] = (
            {"bool": {"must_not": {"terms": {"book": sorted(current)}}}}
            if current
            else {"match_all": {}}
        )
        try:
            self._client.delete_by_query(
                index=self.index,
                query=query,
                refresh=False,
                conflicts="proceed",
            )
        except Exception as exc:
            logger.warning("cannot prune stale chunks: %s", exc)

    def _index_book(self, book: Book, path: Path) -> int:
        try:
            self._client.delete_by_query(
                index=self.index,
                query={"term": {"book": book.rel}},
                refresh=False,
                conflicts="proceed",
            )
        except Exception as exc:
            logger.debug("no stale chunks removed for %s: %s", book.rel, exc)
        operations: list[dict[str, object]] = []
        count = 0
        for chunk in self._chunks(book, path):
            chunk_id = str(chunk.pop("id"))
            operations.append({"index": {"_index": self.index, "_id": chunk_id}})
            operations.append(chunk)
            count += 1
            if len(operations) >= BULK_BATCH * 2:
                self._client.bulk(operations=operations, refresh=False)
                operations = []
        if operations:
            self._client.bulk(operations=operations, refresh=False)
        return count

    def _chunks(self, book: Book, path: Path) -> Iterator[dict[str, object]]:
        if book.kind == "pdf":
            yield from self._pdf_chunks(book, path)
        else:
            yield from self._markdown_chunks(book, path)

    def _pdf_chunks(self, book: Book, path: Path) -> Iterator[dict[str, object]]:
        try:
            pages = self._pdf.page_count(path)
        except Exception as exc:
            logger.warning("cannot index %s: %s", book.rel, exc)
            return
        for page in range(1, pages + 1):
            try:
                text = " ".join(self._pdf.page_text(path, page).split())
            except Exception:
                continue
            if len(text) < 20:
                continue
            yield {
                "id": f"{book.rel}#p{page}",
                "book": book.rel,
                "kind": "pdf",
                "page": page,
                "line": None,
                "line_end": None,
                "section": self._sections.section_for_page(book.rel, path, page),
                "text": text[:20_000],
                "mapping_version": MAPPING_VERSION,
            }

    def _markdown_chunks(self, book: Book, path: Path) -> Iterator[dict[str, object]]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        heading = ""
        block: list[str] = []
        start = 0
        end = 0
        for number, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                if block:
                    yield _markdown_document(book.rel, block, start, end, heading)
                    block = []
                heading = stripped.lstrip("#").strip()
                continue
            if not stripped:
                if block:
                    yield _markdown_document(book.rel, block, start, end, heading)
                    block = []
                continue
            if not block:
                start = number
            block.append(stripped)
            end = number
        if block:
            yield _markdown_document(book.rel, block, start, end, heading)

    def search(
        self,
        query: str,
        *,
        limit: int = 50,
        book: str | None = None,
        kind: str | None = None,
    ) -> list[SearchHit]:
        cleaned = query.strip()
        if not cleaned:
            return []
        filters: list[dict[str, object]] = []
        if book:
            filters.append({"term": {"book": book}})
        if kind:
            filters.append({"term": {"kind": kind}})
        response = self._client.search(
            index=self.index,
            size=limit,
            query={
                "bool": {
                    "must": [
                        {
                            "multi_match": {
                                "query": cleaned,
                                "fields": ["text", "section^2"],
                                "type": "best_fields",
                            }
                        }
                    ],
                    "filter": filters,
                }
            },
            highlight={
                "fields": {"text": {"fragment_size": 180, "number_of_fragments": 1}},
                "pre_tags": [""],
                "post_tags": [""],
            },
        )
        hits: list[SearchHit] = []
        for item in response["hits"]["hits"]:
            source = item.get("_source") or {}
            fragments = (item.get("highlight") or {}).get("text") or []
            snippet = fragments[0] if fragments else str(source.get("text") or "")[:200]
            hits.append(
                SearchHit(
                    book=str(source.get("book") or book or ""),
                    kind=str(source.get("kind") or ""),
                    page=_optional_int(source.get("page")),
                    line=_optional_int(source.get("line")),
                    line_end=_optional_int(source.get("line_end")),
                    section=str(source.get("section") or ""),
                    snippet=snippet,
                )
            )
        return hits


class PageIndexSearch:
    """Vectorless retrieval over PageIndex section trees plus page text.

    Section titles pick candidate regions (layout-derived, cached per file);
    page text inside those regions supplies the scored evidence. When no title
    matches, the document is scanned page by page, so recall never collapses
    to heading wording alone.
    """

    MAX_SCAN_PAGES = 240
    SNIPPET_RADIUS = 90

    def __init__(self, library: Library, sections: SectionIndex, pdf: PdfCache) -> None:
        self._library = library
        self._sections = sections
        self._pdf = pdf

    def search(self, query: str, *, limit: int = 50, book: str | None = None) -> list[SearchHit]:
        terms = _terms(query)
        if not terms or not self._sections.available():
            return []
        scored: list[tuple[int, SearchHit]] = []
        for rel, path in self._books(book):
            scored.extend(self._search_book(rel, path, terms, limit))
            if len(scored) >= limit * 3:
                break
        scored.sort(key=lambda item: (-item[0], item[1]["book"], item[1]["page"] or 0))
        return [hit for _score, hit in scored[:limit]]

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
        title_matches = [section for section in sections if _title_score(section["title"], terms)]
        try:
            total = self._pdf.page_count(path)
        except Exception:
            return []

        title_starts: dict[int, tuple[str, float]] = {}
        title_pages: set[int] = set()
        for match in title_matches:
            strength = _title_score(match["title"], terms) / max(1, len(terms))
            depth = float(match.get("depth", 0))
            candidate = (match["title"], strength + depth * 0.02)
            previous = title_starts.get(match["start_page"])
            if previous is None or candidate[1] > previous[1]:
                title_starts[match["start_page"]] = candidate
            title_pages.update(
                range(match["start_page"], min(match["end_page"], match["start_page"] + 40) + 1)
            )
        page_numbers = sorted(number for number in title_pages if 1 <= number <= total)
        if total <= self.MAX_SCAN_PAGES:
            page_numbers = list(range(1, total + 1))
        else:
            budget = max(0, self.MAX_SCAN_PAGES - len(page_numbers))
            page_numbers += [number for number in range(1, total + 1) if number not in title_pages][
                :budget
            ]
        page_numbers = sorted(set(page_numbers))[: self.MAX_SCAN_PAGES]

        texts: dict[int, str] = {}
        for number in page_numbers:
            try:
                texts[number] = " ".join(self._pdf.page_text(path, number).split())
            except Exception:
                continue
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
                frequency = min(folded.count(term), 5)
                if frequency:
                    content += frequency * (
                        1.0 + math.log(scanned / max(1, document_frequency[term]))
                    )
            title_entry = title_starts.get(number)
            if not content and title_entry is None:
                continue
            score = min(content, 6.0)
            if title_entry is not None:
                score += 6 + 16 * title_entry[1]
            if number in title_pages:
                score += 2
            if len(terms) > 1 and " ".join(terms) in folded:
                score += 4
            section = (
                title_entry[0]
                if title_entry is not None
                else self._sections.section_for_page(rel, path, number)
            )
            if section and _title_score(section, terms):
                score += 3
            if any(term in folded for term in terms):
                snippet = _snippet(text, terms, self.SNIPPET_RADIUS)
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
        if self._mode in {"auto", "pageindex"} and self._sections.available():
            if not self._sections.cached_books():
                raise SearchUnavailable(
                    "no cached PageIndex section trees yet; open a book to build one, "
                    "or configure Elasticsearch"
                )
            return self._tree.search(query, limit=limit)
        raise SearchUnavailable(
            "library-wide search needs Elasticsearch (BOOK_READER_ES_URL) "
            "or the pageindex extra with cached section trees"
        )


def _snippet(text: str, terms: list[str], radius: int) -> str:
    folded = text.casefold()
    positions = [position for term in terms if (position := folded.find(term)) >= 0]
    if not positions:
        return text[: radius * 2]
    start = max(0, min(positions) - radius)
    end = min(len(text), max(positions) + max(len(term) for term in terms) + radius)
    return text[start:end].strip()


_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "its",
    "are",
    "was",
    "were",
    "into",
    "about",
    "over",
    "under",
    "between",
    "their",
    "there",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "how",
    "why",
    "when",
    "where",
    "does",
    "did",
    "can",
    "could",
    "should",
    "would",
    "may",
    "might",
    "not",
    "but",
    "than",
    "then",
    "also",
    "any",
    "all",
    "each",
    "more",
    "most",
    "some",
    "such",
    "only",
    "own",
    "same",
    "too",
    "very",
    "just",
    "give",
    "name",
    "list",
    "cited",
    "work",
}


def _terms(query: str) -> list[str]:
    return [
        term
        for term in re.split(r"[^0-9a-z]+", query.casefold())
        if len(term) > 1 and term not in _STOPWORDS
    ]


def _title_score(title: str, terms: list[str]) -> int:
    tokens = [token for token in re.split(r"[^0-9a-z]+", title.casefold()) if len(token) > 2]
    return sum(
        1
        for term in terms
        if any(token.startswith(term) or term.startswith(token) for token in tokens)
    )


def _markdown_document(
    rel: str, block: list[str], start: int, end: int, section: str
) -> dict[str, object]:
    text = " ".join(" ".join(block).split())
    return {
        "id": f"{rel}#L{start}-{end}",
        "book": rel,
        "kind": "md",
        "page": None,
        "line": start,
        "line_end": end,
        "section": section,
        "text": text[:CHUNK_CHARS],
        "mapping_version": MAPPING_VERSION,
    }


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
