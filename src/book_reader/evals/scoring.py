"""Citation grounding and pedagogy scoring."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from ..library import Library
from .openui import _FENCE_RE, extract_openui_blocks

_INLINE_CITE_RE = re.compile(r"(?<![\\/\w])([\w./-]+\.(?:pdf|md))(?:#(?:p(\d+)|L(\d+)))?\b")


def score_citations(
    answer: str,
    sources: Sequence[dict[str, Any]],
    library: Library | None = None,
) -> tuple[int, float]:
    """Count and score inline + tool citations, checking existence in library when provided."""
    inline_matches = _INLINE_CITE_RE.findall(answer or "")
    cited_books: set[str] = {m[0] for m in inline_matches if m[0]}
    for src in sources or []:
        book = str(src.get("book") or "").strip()
        if book:
            cited_books.add(book)
    for block in extract_openui_blocks(answer or ""):
        if block.get("book"):
            cited_books.add(str(block["book"]).split("#")[0])
        for b in block.get("books") or []:
            if isinstance(b, dict) and b.get("book"):
                cited_books.add(str(b["book"]).split("#")[0])

    total = len(cited_books) + len(inline_matches)
    if total == 0:
        return 0, 0.0

    if library is None:
        return len(cited_books), 1.0

    known_paths = {b.rel for b in library.scan()}
    valid_books = 0
    for rel in cited_books:
        clean = rel.split("#")[0].strip()
        if library.find_book(clean) is not None or any(
            p == clean or p.endswith(f"/{clean}") for p in known_paths
        ):
            valid_books += 1
    if not cited_books:
        return 0, 0.0
    ratio = valid_books / len(cited_books)
    return len(cited_books), round(min(1.0, 0.5 + 0.5 * ratio), 2)


def score_pedagogy(
    answer: str, mode: str, specs: Sequence[dict[str, Any]]
) -> tuple[float, list[str]]:
    """Score pedagogical quality for Master Teacher ('teacher') or Socratic ('tutor') mode."""
    text = (answer or "").strip()
    if not text:
        return 0.0, ["empty response"]

    notes: list[str] = []
    score = 0.0
    comp_names = {str(s.get("component")) for s in specs}

    if mode == "tutor":
        # Socratic tutor rubric:
        # 1. Includes SkillMap or QuizCheck (0.4)
        if "SkillMap" in comp_names or "QuizCheck" in comp_names:
            score += 0.4
            notes.append("has Socratic OpenUI block")
        else:
            notes.append("missing SkillMap/QuizCheck")
        # 2. Asks a question (0.4)
        if "?" in text or "QuizCheck" in comp_names:
            score += 0.4
            notes.append("asks diagnostic/guiding question")
        else:
            notes.append("missing guiding question")
        # 3. Concise turn — avoids dumping a giant lecture (0.2)
        prose_without_fences = _FENCE_RE.sub("", text).strip()
        word_count = len(prose_without_fences.split())
        if word_count <= 350:
            score += 0.2
            notes.append(f"concise Socratic turn ({word_count} words)")
        else:
            notes.append(f"verbose turn ({word_count} words)")
        return round(score, 2), notes

    # Master Teacher rubric:
    # 1. Non-trivial structured explanation (0.4)
    prose_without_fences = _FENCE_RE.sub("", text).strip()
    words = len(prose_without_fences.split())
    if words >= 25 or (words >= 12 and comp_names):
        score += 0.4
        notes.append(f"structured prose ({words} words)")
    elif words >= 8:
        score += 0.2
        notes.append(f"brief prose ({words} words)")

    # 2. Rich formatting: headings, lists, math, or tables (0.3)
    has_structure = bool(
        re.search(r"(^#+\s|\*\*|\$.*\$|^[-*]\s|\|.+\|)", prose_without_fences, re.MULTILINE)
    )
    if has_structure:
        score += 0.3
        notes.append("uses rich Markdown/LaTeX")

    # 3. Valid OpenUI visual component (0.3)
    if comp_names:
        score += 0.3
        notes.append(f"includes {', '.join(sorted(comp_names))}")

    return round(min(1.0, score), 2), notes
