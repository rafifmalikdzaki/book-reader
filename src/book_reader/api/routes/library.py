"""Library index, book detail, PDF thumbnails and raw files."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

from ...library.errors import PathNotFound
from ...library.scan import Library
from ...reading.pdf import PdfCache
from ...reindex.reconciler import LibraryReconciler
from ...reindex.redirects import moved_book_target
from ..views import LibraryViews

logger = logging.getLogger(__name__)

# Only these types are safe to render inline from the library. Everything else is a
# download with a generic media type (notably HTML/SVG, which would run on our origin).
RAW_INLINE_MEDIA = {
    ".pdf": "application/pdf",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
}


def register(
    app: FastAPI,
    *,
    views: LibraryViews,
    library: Library,
    reconciler: LibraryReconciler,
    pdf: PdfCache,
    state_dir: Path,
) -> None:
    """Attach the library, book, thumbnail and raw-file routes."""

    @app.get("/api/library")
    def api_library() -> dict[str, object]:
        return views.index()

    @app.get("/api/book")
    def api_book(
        rel: Annotated[str, Query(alias="path")],
        page: str | None = None,
    ) -> dict[str, object]:
        try:
            target = library.book_file(rel)
        except PathNotFound:
            moved = moved_book_target(rel, library=library, reconciler=reconciler)
            if moved is not None:
                # 200, not 307: a fetch() would follow a 307 into the HTML shell.
                return {"redirect": moved}
            raise
        return views.book_detail(rel, target, page)

    @app.get("/api/book/markdown")
    def api_book_markdown(rel: Annotated[str, Query(alias="path")]) -> dict[str, object]:
        target = library.book_file(rel)
        if target.suffix.lower() != ".md":
            raise HTTPException(status_code=400, detail="not a Markdown file")
        return views.markdown_view(rel, target)

    @app.get("/thumb.jpg")
    def thumbnail(
        request: Request,
        rel: Annotated[str, Query(alias="path")],
        width: Annotated[int, Query(ge=120, le=640)] = 300,
    ) -> Response:
        target = library.book_file(rel)
        if target.suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail="not a PDF")
        stat = target.stat()
        content_id = reconciler.content_id(rel)
        if not content_id:
            content_id = hashlib.sha256(
                f"{rel}:{stat.st_size}:{stat.st_mtime_ns}".encode()
            ).hexdigest()
        etag = f'W/"{content_id}-{width}"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        thumb_dir = Path(state_dir) / "thumbs"
        cache = thumb_dir / f"{content_id}-{width}.jpg"
        try:
            if not cache.is_file():
                png = pdf.thumbnail(target, width)
                thumb_dir.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_name(cache.name + ".tmp")
                tmp.write_bytes(png)
                os.replace(tmp, cache)
            data = cache.read_bytes()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"cannot render preview: {exc}") from exc
        return Response(
            data,
            media_type="image/jpeg",
            headers={"ETag": etag, "Cache-Control": "private, max-age=31536000, immutable"},
        )

    @app.get("/raw/{rel:path}")
    def raw(rel: str) -> FileResponse:
        target = library.any_file(rel)
        media_type = RAW_INLINE_MEDIA.get(target.suffix.lower())
        if media_type is not None:
            return FileResponse(
                target,
                media_type=media_type,
                headers={"X-Content-Type-Options": "nosniff"},
            )
        return FileResponse(
            target,
            media_type="application/octet-stream",
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": "attachment",
            },
        )
