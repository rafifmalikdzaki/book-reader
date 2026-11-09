"""Query-term, snippet and chunk helpers shared by the search backends."""

from __future__ import annotations

import re

CHUNK_CHARS = 4000
MAPPING_VERSION = 1


def snippet_around(text: str, terms: list[str], radius: int) -> str:
    folded = text.casefold()
    positions = [position for term in terms if (position := folded.find(term)) >= 0]
    if not positions:
        return text[: radius * 2]
    start = max(0, min(positions) - radius)
    end = min(len(text), max(positions) + max(len(term) for term in terms) + radius)
    return text[start:end].strip()


STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "its",
    "are",
    "was",
    "were",
    "into",
    "about",
    "over",
    "under",
    "between",
    "their",
    "there",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "how",
    "why",
    "when",
    "where",
    "does",
    "did",
    "can",
    "could",
    "should",
    "would",
    "may",
    "might",
    "not",
    "but",
    "than",
    "then",
    "also",
    "any",
    "all",
    "each",
    "more",
    "most",
    "some",
    "such",
    "only",
    "own",
    "same",
    "too",
    "very",
    "just",
    "give",
    "name",
    "list",
    "cited",
    "work",
}


def query_terms(query: str) -> list[str]:
    return [
        term
        for term in re.split(r"[^0-9a-z]+", query.casefold())
        if len(term) > 1 and term not in STOPWORDS
    ]


def title_score(title: str, terms: list[str]) -> int:
    tokens = [token for token in re.split(r"[^0-9a-z]+", title.casefold()) if len(token) > 2]
    return sum(
        1
        for term in terms
        if any(token.startswith(term) or term.startswith(token) for token in tokens)
    )


def markdown_chunk(
    rel: str, block: list[str], start: int, end: int, section: str
) -> dict[str, object]:
    text = " ".join(" ".join(block).split())
    return {
        "id": f"{rel}#L{start}-{end}",
        "book": rel,
        "kind": "md",
        "page": None,
        "line": start,
        "line_end": end,
        "section": section,
        "text": text[:CHUNK_CHARS],
        "mapping_version": MAPPING_VERSION,
    }


def optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
