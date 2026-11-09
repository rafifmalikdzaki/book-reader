"""Serve the React SPA shell for the client-routed pages."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from .library.scan import Library
from .reindex.reconciler import LibraryReconciler
from .reindex.redirects import moved_book_target

logger = logging.getLogger(__name__)

BUILD_HINT = "scripts/build_frontend.sh"
SHELL_HEADERS = {"Cache-Control": "no-cache"}

_MISSING_BUNDLE_PAGE = f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>book-reader: frontend not built</title></head>
<body>
<h1>The frontend bundle is missing</h1>
<p>Run <code>{BUILD_HINT}</code> to build it, then reload.</p>
</body>
</html>
"""


def moved_book_redirect(
    request: Request, rel: str, *, library: Library, reconciler: LibraryReconciler
) -> RedirectResponse | None:
    """307 to the book's new path if a reindex shows it moved, else ``None``."""
    moved = moved_book_target(rel, library=library, reconciler=reconciler)
    if moved is not None:
        location = f"/book/{quote(moved)}"
        if request.url.query:
            location += "?" + request.url.query
        return RedirectResponse(url=location, status_code=307)
    return None


def register(
    app: FastAPI,
    *,
    library: Library,
    reconciler: LibraryReconciler,
    spa_dir: Path,
) -> None:
    """Attach the SPA shell routes."""
    index_file = spa_dir / "index.html"

    def shell(status_code: int = 200) -> Response:
        try:
            html = index_file.read_text(encoding="utf-8")
        except OSError:
            return HTMLResponse(
                _MISSING_BUNDLE_PAGE, status_code=503, headers={"Cache-Control": "no-store"}
            )
        return HTMLResponse(html, status_code=status_code, headers=SHELL_HEADERS)

    @app.get("/", response_class=HTMLResponse)
    def index() -> Response:
        return shell()

    @app.get("/ask", response_class=HTMLResponse)
    def ask() -> Response:
        return shell()

    @app.get("/design", response_class=HTMLResponse)
    def design() -> Response:
        return shell()

    @app.get("/book/{rel:path}", response_class=HTMLResponse)
    def book(request: Request, rel: str) -> Response:
        try:
            library.book_file(rel)
        except HTTPException as exc:
            if exc.status_code == 404:
                redirect = moved_book_redirect(request, rel, library=library, reconciler=reconciler)
                if redirect is not None:
                    return redirect
            # Unknown or invalid book: the SPA renders its own error view.
            return shell(status_code=exc.status_code)
        return shell()
