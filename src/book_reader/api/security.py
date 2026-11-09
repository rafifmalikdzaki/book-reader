"""Response hardening: a Host check for loopback binds and a report-only CSP for the shell.

The CSP is report-only and applies to the React shell. Only the SPA's own HTML responses
get the header. The vendored PDF.js viewer (served under ``/static``) already enforces a
stricter policy through a ``<meta>`` tag, and JSON/static/raw responses are not documents,
so none of those are touched. ``frame-ancestors`` is left out because browsers ignore it
in report-only mode.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from starlette.responses import PlainTextResponse, Response

CSP_HEADER = "Content-Security-Policy-Report-Only"

CSP_REPORT_ONLY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        # pdf.js only builds a blob: worker for a cross-origin workerSrc; ours is same-origin.
        "worker-src 'self'",
        # React and KaTeX emit style="" attributes, which need 'unsafe-inline'.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        # The PDF.js viewer iframe is same-origin.
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    )
)


LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")


def allowed_hosts_for(bind_host: str, override: str = "") -> tuple[str, ...] | None:
    """Host names the server answers to, or ``None`` for no Host check.

    A comma-separated ``override`` (``BOOK_READER_ALLOWED_HOSTS``) wins. Otherwise a
    loopback bind accepts loopback names only, which stops DNS rebinding from a web page
    that points its own name at 127.0.0.1. A deliberate non-loopback bind is unrestricted.
    """
    listed = tuple(name.strip() for name in override.split(",") if name.strip())
    if listed:
        return listed
    if bind_host in LOOPBACK_HOSTS:
        return LOOPBACK_HOSTS
    return None


def _hostname(header: str) -> str:
    """Lower-case host from a ``Host`` header, without port or IPv6 brackets."""
    try:
        return (urlsplit("//" + header).hostname or "").lower()
    except ValueError:
        return ""


def install_host_check(app: FastAPI, allowed: Sequence[str]) -> None:
    """Reject requests whose ``Host`` header is not one of ``allowed`` (HTTP 400).

    An entry starting with ``.`` matches any subdomain (``.ngrok-free.app`` accepts
    ``abc.ngrok-free.app`` but not the bare domain or ``evilngrok-free.app``).
    """
    names = {name.strip("[]").lower() for name in allowed if not name.startswith(".")}
    suffixes = tuple(name.lower() for name in allowed if name.startswith("."))

    @app.middleware("http")
    async def host_check(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        host = _hostname(request.headers.get("host", ""))
        if host not in names and not host.endswith(suffixes):
            return PlainTextResponse("Invalid host header", status_code=400)
        return await call_next(request)


def install(app: FastAPI) -> None:
    """Attach the report-only CSP to the app's HTML document responses."""

    @app.middleware("http")
    async def content_security_policy(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if not request.url.path.startswith("/static/") and response.headers.get(
            "content-type", ""
        ).startswith("text/html"):
            response.headers[CSP_HEADER] = CSP_REPORT_ONLY
        return response
