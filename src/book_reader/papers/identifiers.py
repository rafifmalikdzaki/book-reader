"""Recognise DOIs and arXiv ids in whatever form a reader pastes them."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import InvalidIdentifier

# New-style (2403.04807, optional version) and old-style (hep-th/9901001) arXiv ids.
_ARXIV_NEW = re.compile(r"(?<![\d.])(\d{4}\.\d{4,5})(v\d+)?(?![\d])")
_ARXIV_OLD = re.compile(r"\b([a-z-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?\b")
_ARXIV_DOI = re.compile(r"10\.48550/arxiv\.(.+)$", re.IGNORECASE)
_DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.IGNORECASE)
_ARXIV_HINT = re.compile(r"arxiv", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class PaperId:
    kind: str  # "arxiv" | "doi"
    value: str


def parse_identifier(text: str) -> PaperId:
    """``arXiv:2403.04807``, an arxiv.org URL, a bare DOI or a doi.org URL."""
    raw = text.strip()
    if not raw or len(raw) > 400:
        raise InvalidIdentifier("Paste a DOI (10.1234/…) or an arXiv id (2403.04807).")

    doi = _DOI.search(raw)
    if doi:
        value = doi.group(1).rstrip(".,;)")
        arxiv_doi = _ARXIV_DOI.match(value)
        if arxiv_doi:
            # arXiv's own DOIs resolve to an arXiv id, which has a direct PDF.
            return PaperId("arxiv", arxiv_doi.group(1))
        return PaperId("doi", value)

    new = _ARXIV_NEW.search(raw)
    if new:
        return PaperId("arxiv", new.group(1) + (new.group(2) or ""))
    if _ARXIV_HINT.search(raw):
        old = _ARXIV_OLD.search(raw)
        if old:
            return PaperId("arxiv", old.group(1) + (old.group(2) or ""))
    raise InvalidIdentifier("Paste a DOI (10.1234/…) or an arXiv id (2403.04807).")
