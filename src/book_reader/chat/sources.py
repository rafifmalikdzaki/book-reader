"""Turning tool output and search hits into citeable sources."""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING

from langchain_core.messages import (
    BaseMessage,
    ToolMessage,
)

from ..search import SearchHit

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def _hit_source(hit: SearchHit) -> dict[str, object]:
    return {
        "book": hit["book"],
        "page": hit["page"],
        "line": hit["line"],
        "line_end": hit["line_end"],
        "section": hit["section"],
        "snippet": hit["snippet"],
    }


def _with_context_source(
    sources: list[dict[str, object]],
    book: str | None,
    page: int | None,
    *,
    excerpt: str,
) -> list[dict[str, object]]:
    """Link the page only when its real text was supplied to the model."""
    if not excerpt or not book or not page:
        return sources
    if any(str(source.get("book")) == book and source.get("page") == page for source in sources):
        return sources
    return [{"book": book, "page": page}, *sources][:20]


def collect_sources(messages: Sequence[BaseMessage]) -> list[dict[str, object]]:
    """Unique locators reported by tool results, in call order."""
    sources: list[dict[str, object]] = []
    seen: set[tuple[object, object, object]] = set()
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        try:
            payload = json.loads(str(message.content))
        except (TypeError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        raw = payload.get("sources")
        if not isinstance(raw, list):
            continue
        for item in raw:
            if not isinstance(item, dict):
                continue
            key = (item.get("book"), item.get("page"), item.get("line"))
            if key in seen:
                continue
            seen.add(key)
            sources.append(dict(item))
    return sources[:20]
