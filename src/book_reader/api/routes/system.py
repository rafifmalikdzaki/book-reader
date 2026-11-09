"""Process-level routes: health check and manual reindex."""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException

from ...reindex.reconciler import LibraryReconciler

logger = logging.getLogger(__name__)


def register(app: FastAPI, *, reconciler: LibraryReconciler) -> None:
    """Attach /healthz and /api/library/reindex."""

    @app.post("/api/library/reindex")
    def api_library_reindex() -> dict[str, object]:
        try:
            report = reconciler.sync()
        except Exception as exc:
            logger.exception("manual reindex failed")
            raise HTTPException(status_code=500, detail=f"reindex failed: {exc}") from exc
        return report.as_dict()

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}
