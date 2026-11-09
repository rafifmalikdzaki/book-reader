"""Search and the Elasticsearch/PageIndex index status."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query

from ...library.errors import LibraryError
from ...library.scan import Library
from ...reading.sections import SectionIndex
from ...search.elastic import ElasticSearch
from ...search.service import Searcher
from ...search.types import SearchUnavailable

logger = logging.getLogger(__name__)

SEARCH_LIMIT_MAX = 200


def register(
    app: FastAPI,
    *,
    library: Library,
    searcher: Searcher,
    elastic: ElasticSearch | None,
    sections: SectionIndex,
) -> None:
    """Attach the search and index routes."""

    @app.get("/api/search")
    def api_search(
        q: str = "",
        rel: Annotated[str | None, Query(alias="path")] = None,
        limit: Annotated[int, Query(ge=1, le=SEARCH_LIMIT_MAX)] = 50,
    ) -> dict[str, object]:
        if rel is not None:
            target = library.book_file(rel)
            try:
                hits, backend = searcher.in_book(rel, target, q, limit)
            except (HTTPException, LibraryError):
                raise
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"search failed: {exc}") from exc
            kind = "md" if target.suffix.lower() == ".md" else "pdf"
            return {"kind": kind, "backend": backend, "hits": hits}
        if not q.strip():
            return {"kind": "library", "backend": searcher.backend(), "hits": []}
        try:
            hits = searcher.library_wide(q, limit)
        except SearchUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"kind": "library", "backend": searcher.backend(), "hits": hits}

    @app.get("/api/index/status")
    def api_index_status() -> dict[str, object]:
        present_books = {book.rel for book in library.scan()}
        return {
            "elasticsearch": {
                "url": elastic.url if elastic else None,
                "index": elastic.index if elastic else None,
                "available": bool(elastic and elastic.available()),
                "reachable": bool(elastic and elastic.reachable()),
                "chunks": elastic.chunk_count() if elastic else None,
                "job": elastic.rebuild_job.snapshot() if elastic else None,
            },
            "pageindex": {
                "available": sections.available(),
                "cached_books": len(
                    [rel for rel in sections.cached_books() if rel in present_books]
                ),
            },
            "search_backend": searcher.backend(),
        }

    @app.post("/api/index/rebuild")
    def api_index_rebuild(force: bool = False) -> dict[str, object]:
        if elastic is None:
            raise HTTPException(
                status_code=503,
                detail="Elasticsearch is not configured; set BOOK_READER_ES_URL",
            )
        if not elastic.reachable():
            raise HTTPException(
                status_code=503, detail=f"Elasticsearch is not reachable at {elastic.url}"
            )
        started = elastic.rebuild_job.start(lambda: elastic.rebuild(library, force=force))
        return {"ok": True, "started": started, "job": elastic.rebuild_job.snapshot()}
