"""Static assets: gzip-precompressed serving and cache headers for the bundled SPA/vendor files."""

from __future__ import annotations

import mimetypes
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

mimetypes.add_type("text/javascript", ".mjs")


class GzipStaticFiles(StaticFiles):
    """Serve precompressed text assets when the browser accepts gzip."""

    async def get_response(self, path: str, scope: object) -> Response:
        headers = Headers(scope=scope)  # type: ignore[arg-type]
        if "gzip" in headers.get("accept-encoding", ""):
            root = Path(str(self.directory)).resolve()
            source: Path | None = None
            compressed: Path | None = None
            try:
                source = (root / path).resolve()
                compressed = source.with_name(source.name + ".gz").resolve()
            except (OSError, RuntimeError):
                pass
            if (
                source is not None
                and compressed is not None
                and source.is_relative_to(root)
                and compressed.is_relative_to(root)
                and compressed.is_file()
            ):
                media_type, _encoding = mimetypes.guess_type(str(source))
                return FileResponse(
                    compressed,
                    media_type=media_type or "application/octet-stream",
                    headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
                )
        return await super().get_response(path, scope)  # type: ignore[arg-type]


def install(app: FastAPI) -> None:
    """Cache-header middleware and response compression."""

    @app.middleware("http")
    async def revalidate_static(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        path = request.url.path
        if path.startswith(("/static/vendor/", "/static/fonts/", "/static/app/assets/")):
            # Pinned or hashed files. A miss (mid-rebuild, typo) must not be cached; 304 and 206
            # keep `immutable` so a conditional or range request does not downgrade the stored copy.
            immutable = "public, max-age=31536000, immutable"
            response.headers["Cache-Control"] = (
                immutable if response.status_code in (200, 206, 304) else "no-cache"
            )
        elif path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=6,
        exclude_content_types=(*DEFAULT_EXCLUDED_CONTENT_TYPES, "application/pdf"),
    )
