"""Elasticsearch chunk index and its background rebuild job."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path

from elasticsearch import Elasticsearch

from ..library.models import Book
from ..library.scan import Library
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from .text import MAPPING_VERSION, markdown_chunk, optional_int
from .types import SearchHit

BULK_BATCH = 500

logger = logging.getLogger(__name__)


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
                self._check_bulk(self._client.bulk(operations=operations, refresh=False), book.rel)
                operations = []
        if operations:
            self._check_bulk(self._client.bulk(operations=operations, refresh=False), book.rel)
        return count

    @staticmethod
    def _check_bulk(response: object, rel: str) -> None:
        """Bulk responses report per-document failures without raising."""
        if not isinstance(response, dict) or not response.get("errors"):
            return
        items = response.get("items") or []
        failed = sum(
            1
            for item in items
            if isinstance(item, dict)
            and any(
                isinstance(result, dict) and int(result.get("status", 200)) >= 300
                for result in item.values()
            )
        )
        raise RuntimeError(f"bulk indexing failed for {failed or len(items)} chunk(s) of {rel}")

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
                    yield markdown_chunk(book.rel, block, start, end, heading)
                    block = []
                heading = stripped.lstrip("#").strip()
                continue
            if not stripped:
                if block:
                    yield markdown_chunk(book.rel, block, start, end, heading)
                    block = []
                continue
            if not block:
                start = number
            block.append(stripped)
            end = number
        if block:
            yield markdown_chunk(book.rel, block, start, end, heading)

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
                    page=optional_int(source.get("page")),
                    line=optional_int(source.get("line")),
                    line_end=optional_int(source.get("line_end")),
                    section=str(source.get("section") or ""),
                    snippet=snippet,
                )
            )
        return hits
