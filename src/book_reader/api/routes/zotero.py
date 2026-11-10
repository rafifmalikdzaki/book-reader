"""Zotero metadata for the library (read-only; see ``zotero/library.py``)."""

from __future__ import annotations

from fastapi import FastAPI

from ...library.scan import Library
from ...zotero.library import ZoteroLibrary


def register(app: FastAPI, *, zotero: ZoteroLibrary | None, library: Library) -> None:
    """Attach /api/zotero."""

    @app.get("/api/zotero")
    def api_zotero() -> dict[str, object]:
        if zotero is None:
            return {
                "available": False,
                "reason": "Zotero is not configured; start with --zotero-dir.",
                "item_count": 0,
                "matched": 0,
                "books": {},
                "collections": [],
            }
        return zotero.snapshot(library.scan(), library.root)
