"""Import a paper into the library folder and read keywords back out of library PDFs.

Imported files land in ``<library>/Papers/``. Their title, authors, keywords and DOI are
written into the PDF's own metadata, so they travel with the file and no state store is
needed. Nothing already in the library is modified or overwritten.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import threading
import unicodedata
from collections.abc import Iterable
from pathlib import Path

import pymupdf

from ..library.models import Book
from ..library.scan import Library
from .errors import PaperError
from .fetch import Paper, PaperFetcher
from .identifiers import parse_identifier

logger = logging.getLogger(__name__)

PAPERS_DIR = "Papers"
MAX_KEYWORDS = 8
MAX_KEYWORD_LENGTH = 48

_UNSAFE = re.compile(r"[^\w .,()'-]+")
_SPLIT = re.compile(r"\s*[;,]\s*")
# Scraped e-books carry their source site as a "keyword"; a link is never a topic.
_LINK = re.compile(r"(?:https?://|www\.|\.(?:com|net|org|info|io|ir)\b)", re.IGNORECASE)
# ISBNs and other bare numbers get filed as keywords too.
_WORDY = re.compile(r"[^\W\d_]{2}")
_DOI_IN_TEXT = re.compile(r"10\.\d{4,9}/[^\s\"<>;,]+", re.IGNORECASE)


def paper_filename(paper: Paper) -> str:
    """``Surname 2024 - Title.pdf``, restricted to characters every filesystem accepts."""
    surname = paper.authors[0].split()[-1] if paper.authors else ""
    lead = " ".join(part for part in (surname, paper.year) if part)
    text = f"{lead} - {paper.title}" if lead else paper.title
    text = unicodedata.normalize("NFKC", text)
    text = " ".join(_UNSAFE.sub(" ", text).split()).strip(" .")
    return (text[:140].rstrip(" .") or "paper") + ".pdf"


def embed_metadata(path: Path, paper: Paper) -> None:
    """Append the registry's metadata to the PDF in place; leave the file alone on failure."""
    try:
        with pymupdf.open(path) as doc:  # type: ignore[no-untyped-call]
            if not doc.can_save_incrementally():
                raise ValueError("not incrementally writable")
            current = dict(doc.metadata or {})
            subject = str(current.get("subject") or "")
            current.update(
                {
                    "title": paper.title,
                    "author": "; ".join(paper.authors),
                    "keywords": "; ".join(paper.keywords),
                    "subject": f"doi:{paper.doi}" if paper.doi else subject,
                }
            )
            doc.set_metadata(current)
            doc.saveIncr()
    except Exception:
        logger.info("could not embed metadata into %s; saving the PDF unchanged", paper.identifier)


def split_keywords(raw: str) -> list[str]:
    words: list[str] = []
    seen: set[str] = set()
    for part in _SPLIT.split(raw.strip()):
        word = " ".join(part.split())
        key = word.casefold()
        if _LINK.search(word) or not _WORDY.search(word) or key in seen:
            continue
        if 1 < len(word) <= MAX_KEYWORD_LENGTH:
            words.append(word)
            seen.add(key)
    return words[:MAX_KEYWORDS]


class PaperService:
    """Imports papers and serves the keywords embedded in the library's PDFs."""

    def __init__(self, library: Library, fetcher: PaperFetcher) -> None:
        self._library = library
        self._fetcher = fetcher
        self._lock = threading.Lock()
        self._keywords: dict[tuple[str, int, float], dict[str, object]] = {}

    def import_paper(self, identifier: str) -> dict[str, object]:
        paper_id = parse_identifier(identifier)
        paper = self._fetcher.describe(paper_id)
        folder = self._library.root / PAPERS_DIR
        target = folder / paper_filename(paper)
        rel = target.relative_to(self._library.root).as_posix()
        if target.exists():
            return _result(paper, rel, created=False)
        try:
            folder.mkdir(exist_ok=True)
            handle, temporary = tempfile.mkstemp(dir=folder, prefix=".import-", suffix=".part")
        except OSError as exc:
            raise PaperError(f"The paper could not be saved into the library: {exc}") from exc
        try:
            # Streamed to disk: a paper can be far larger than it is worth holding in memory.
            with os.fdopen(handle, "w+b") as out:
                self._fetcher.download(paper, out)
            embed_metadata(Path(temporary), paper)
            os.chmod(temporary, 0o644)  # mkstemp's 0600 would hide it from other readers
            # link() fails if the name was taken meanwhile, so nothing is ever overwritten.
            os.link(temporary, target)
        except FileExistsError:
            return _result(paper, rel, created=False)
        except OSError as exc:
            raise PaperError(f"The paper could not be saved into the library: {exc}") from exc
        finally:
            os.unlink(temporary)
        self._library.scan(force=True)
        return _result(paper, rel, created=True)

    def keywords(self, books: Iterable[Book]) -> dict[str, dict[str, object]]:
        """Embedded keywords, authors and DOI for each PDF that carries any."""
        found: dict[str, dict[str, object]] = {}
        fresh: dict[tuple[str, int, float], dict[str, object]] = {}
        for book in books:
            if book.kind != "pdf":
                continue
            key = (book.rel, book.size, book.mtime)
            with self._lock:
                entry = self._keywords.get(key)
            if entry is None:
                entry = _read_metadata(self._library.root / book.rel)
            fresh[key] = entry
            if entry["keywords"] or entry["doi"]:
                found[book.rel] = entry
        with self._lock:
            self._keywords = fresh
        return found


def _result(paper: Paper, rel: str, *, created: bool) -> dict[str, object]:
    return {
        "rel": rel,
        "created": created,
        "source": paper.source,
        "identifier": paper.identifier,
        "title": paper.title,
        "authors": paper.authors,
        "year": paper.year,
        "keywords": paper.keywords,
    }


def _read_metadata(path: Path) -> dict[str, object]:
    try:
        with pymupdf.open(path) as doc:  # type: ignore[no-untyped-call]
            meta = dict(doc.metadata or {})
    except Exception:
        meta = {}
    doi = _DOI_IN_TEXT.search(str(meta.get("subject") or ""))
    return {
        "keywords": split_keywords(str(meta.get("keywords") or "")),
        # An author field is only trusted beside a DOI: elsewhere it is often the typesetter.
        "authors": split_keywords(str(meta.get("author") or "")) if doi else [],
        "doi": doi.group(0) if doi else "",
    }
