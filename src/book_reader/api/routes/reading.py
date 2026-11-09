"""Reading state: saved position and cached page counts."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

from ...library.scan import Library
from ...reading.pages import PageIndex
from ...reading.progress import ProgressStore
from ..views import LibraryViews

logger = logging.getLogger(__name__)


class ProgressBody(BaseModel):
    path: str
    page: int | None = None
    scroll: float | None = None


def register(
    app: FastAPI,
    *,
    views: LibraryViews,
    library: Library,
    progress: ProgressStore,
    pages: PageIndex,
) -> None:
    """Attach the reading-position and page-count routes."""

    @app.get("/api/progress")
    def api_progress_get(rel: Annotated[str, Query(alias="path")]) -> dict[str, object]:
        library.book_file(rel)
        return {"path": rel, **views.stored_progress(rel)}

    @app.post("/api/progress")
    def api_progress(body: ProgressBody) -> dict[str, bool]:
        library.book_file(body.path)
        if body.page is not None and body.page < 1:
            raise HTTPException(status_code=400, detail="page must be >= 1")
        if body.scroll is not None and not 0.0 <= body.scroll <= 1.0:
            raise HTTPException(status_code=400, detail="scroll must be within 0..1")
        if body.page is None and body.scroll is None:
            raise HTTPException(status_code=400, detail="nothing to record")
        progress.update(body.path, page=body.page, scroll=body.scroll)
        return {"ok": True}

    @app.get("/api/pages")
    def api_pages() -> dict[str, object]:
        books = library.scan()
        items: list[tuple[str, Path]] = []
        for book in books:
            if book.kind != "pdf":
                continue
            path = library.find_book(book.rel)
            if path is not None:
                items.append((book.rel, path))
        counts = pages.counts(items)
        response: dict[str, int | None] = {}
        for book in books:
            if book.kind != "pdf":
                response[book.rel] = None
            elif book.rel in counts:
                response[book.rel] = counts[book.rel]
        return {"counts": response}
