"""Search backends: Elasticsearch when configured, in-process text scan otherwise."""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Iterator
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

    def available(self) -> bool:
        try:
            self._client.options(request_timeout=1).info()
        except Exception:
            return False
        return True

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
        try:
            self._client.indices.refresh(index=self.index)
        except Exception as exc:
            logger.warning("cannot refresh %s: %s", self.index, exc)
        return {"indexed": indexed, "skipped": skipped, "chunks": chunks}

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


class Searcher:
    """In-book and library-wide search with a local fallback."""

    def __init__(
        self,
        library: Library,
        pdf: PdfCache,
        sections: SectionIndex,
        elastic: ElasticSearch | None,
    ) -> None:
        self._library = library
        self._pdf = pdf
        self._sections = sections
        self._elastic = elastic

    def backend(self) -> str:
        if self._elastic is not None and self._elastic.available():
            return "elasticsearch"
        return "local"

    def in_book(self, rel: str, target: Path, query: str, limit: int) -> list[SearchHit]:
        if not query.strip():
            return []
        if self._elastic is not None and self._elastic.available():
            hits = self._elastic.search(query, limit=limit, book=rel)
            if hits:
                return hits
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
            ]
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
        ]

    def library_wide(self, query: str, limit: int) -> list[SearchHit]:
        if self._elastic is None:
            raise SearchUnavailable(
                "library-wide search needs Elasticsearch; set BOOK_READER_ES_URL"
            )
        if not self._elastic.available():
            raise SearchUnavailable(f"Elasticsearch is not reachable at {self._elastic.url}")
        return self._elastic.search(query, limit=limit)


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
