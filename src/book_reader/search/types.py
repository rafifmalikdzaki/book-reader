"""Search result and error types shared by every backend."""

from __future__ import annotations

from typing import TypedDict


class SearchHit(TypedDict):
    book: str
    kind: str
    page: int | None
    line: int | None
    line_end: int | None
    section: str
    snippet: str


class SearchUnavailable(RuntimeError):
    """Raised when a search needs Elasticsearch and it is not reachable."""
