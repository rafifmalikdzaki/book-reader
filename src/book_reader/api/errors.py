"""Map domain errors to the JSON ``{"detail": ...}`` responses the SPA already expects."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..chat.config import UnknownModel
from ..library.errors import InvalidPath, LibraryError, PathNotFound
from ..papers.errors import PaperError


def status_for(exc: LibraryError) -> int:
    return 404 if isinstance(exc, PathNotFound) else 400


def install(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    def http_error(_request: Request, exc: HTTPException) -> Response:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(InvalidPath)
    @app.exception_handler(PathNotFound)
    def library_error(_request: Request, exc: LibraryError) -> Response:
        return JSONResponse({"detail": exc.detail}, status_code=status_for(exc))

    @app.exception_handler(PaperError)
    def paper_error(_request: Request, exc: PaperError) -> Response:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @app.exception_handler(UnknownModel)
    def unknown_model(_request: Request, exc: UnknownModel) -> Response:
        return JSONResponse({"detail": str(exc)}, status_code=400)
