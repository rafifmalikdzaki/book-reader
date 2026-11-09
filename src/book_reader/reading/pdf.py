"""PDF document cache: page rendering, text search, table of contents."""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path

import pymupdf

logger = logging.getLogger(__name__)

SNIPPET_RADIUS = 60


def _clean_title(raw: object) -> str | None:
    value = " ".join(str(raw or "").replace("\x00", " ").split())
    if len(value) < 4:
        return None
    if value.casefold().endswith(".pdf") or value.casefold() in {"untitled", "unknown"}:
        return None
    return value


_GENERIC_TITLES = {
    "contents",
    "cover",
    "foreword",
    "introduction",
    "preface",
    "table of contents",
    "title page",
}


_NUMBERED_HEADING = re.compile(
    r"^\s*(?:(?:chapter|part|section)\s+[\divxlc]+|\d+(?:\.\d+)*)"
    r"\s*[.:)\-\u2013\u2014]?\s+",
    re.IGNORECASE,
)


_PART_HEADING = re.compile(
    r"^\s*(?:part|chapter|section|volume)\s+(?:[ivxlcdm]+|\d+)\b",
    re.IGNORECASE,
)


def _looks_like_document_title(value: str) -> bool:
    """Reject chapter headings that an outline puts on page one."""
    normalized = value.casefold().strip(" .:;-")
    if normalized in _GENERIC_TITLES:
        return False
    return not (_NUMBERED_HEADING.match(value) or _PART_HEADING.match(value))


def _outline_title(doc: pymupdf.Document) -> str | None:
    """A document title from the first outline entry when it is unambiguous.

    Academic PDFs commonly lose the metadata title but keep the paper title as
    the only level-1 outline entry on page one. A book whose outline starts at
    chapter one (page > 1) or has several level-1 entries on page one is left
    to the caller's fallback.
    """
    try:
        toc = doc.get_toc(simple=True)
    except Exception:
        return None
    if not toc:
        return None
    level, title, page = toc[0]
    if level != 1 or page > 1:
        return None
    cleaned = _clean_title(title)
    if not cleaned or not _looks_like_document_title(cleaned):
        return None
    first_page_level_one = [entry for entry in toc if entry[0] == 1 and entry[2] <= 1]
    if len(first_page_level_one) != 1:
        return None
    return cleaned


class PdfCache:
    """A small LRU of open PyMuPDF documents.

    PyMuPDF documents are not thread-safe, so every operation holds ``_lock``
    for its entire body. FastAPI runs the sync endpoints in a threadpool, hence
    the lock rather than relying on the event loop.
    """

    def __init__(self, max_open: int = 3, max_word_pages: int = 16) -> None:
        self._max_open = max(1, max_open)
        self._words_max = max(1, max_word_pages)
        self._lock = threading.RLock()
        self._docs: OrderedDict[tuple[str, float], pymupdf.Document] = OrderedDict()
        self._word_cache: OrderedDict[tuple[str, float, int], dict[str, object]] = OrderedDict()
        self._text_max = 64
        self._text_cache: OrderedDict[tuple[str, float, int], str] = OrderedDict()
        self._title_cache: OrderedDict[tuple[str, float], str | None] = OrderedDict()

    def _doc(self, path: Path) -> pymupdf.Document:
        key = (str(path), path.stat().st_mtime)
        doc = self._docs.get(key)
        if doc is not None:
            self._docs.move_to_end(key)
            return doc
        doc = pymupdf.open(path)
        if doc.needs_pass:
            doc.close()
            raise ValueError("password-protected PDF")
        self._docs[key] = doc
        while len(self._docs) > self._max_open:
            _, evicted = self._docs.popitem(last=False)
            evicted.close()
        return doc

    def page_count(self, path: Path) -> int:
        with self._lock:
            return int(self._doc(path).page_count)

    def thumbnail(self, path: Path, width: int) -> bytes:
        with self._lock:
            doc = self._doc(path)
            page = doc.load_page(0)
            source_width = float(page.rect.width) or 1.0
            zoom = max(0.05, min(4.0, width / source_width))
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            return bytes(pixmap.tobytes("jpg", jpg_quality=80))

    def title(self, path: Path) -> str | None:
        """The document's embedded title, when it carries a real one."""
        try:
            stamp = path.stat().st_mtime
        except OSError:
            return None
        key = (str(path), stamp)
        with self._lock:
            if key in self._title_cache:
                self._title_cache.move_to_end(key)
                return self._title_cache[key]
            try:
                doc = self._doc(path)
                raw = (doc.metadata or {}).get("title")
                value = _clean_title(raw) or _outline_title(doc)
            except Exception:
                value = None
            self._title_cache[key] = value
            while len(self._title_cache) > 512:
                self._title_cache.popitem(last=False)
            return value

    def page_text(self, path: Path, page: int) -> str:
        key = (str(path), path.stat().st_mtime, page)
        with self._lock:
            cached = self._text_cache.get(key)
            if cached is not None:
                self._text_cache.move_to_end(key)
                return cached
            doc = self._doc(path)
            if not 1 <= page <= doc.page_count:
                raise ValueError(f"page out of range: {page}")
            text = str(doc.load_page(page - 1).get_text("text"))
            self._text_cache[key] = text
            while len(self._text_cache) > self._text_max:
                self._text_cache.popitem(last=False)
            return text

    def page_words(self, path: Path, page: int) -> dict[str, object]:
        """Words with bounding boxes, block, and line numbers for the text layer."""
        key = (str(path), path.stat().st_mtime, page)
        with self._lock:
            cached = self._word_cache.get(key)
            if cached is not None:
                self._word_cache.move_to_end(key)
                return cached
            doc = self._doc(path)
            if not 1 <= page <= doc.page_count:
                raise ValueError(f"page out of range: {page}")
            pdf_page = doc.load_page(page - 1)
            raw_words = pdf_page.get_text("words") or []
            rect = pdf_page.rect
            width, height = float(rect.width), float(rect.height)
        words = [
            {
                "t": str(word[4]),
                "x0": float(word[0]),
                "y0": float(word[1]),
                "x1": float(word[2]),
                "y1": float(word[3]),
                "b": int(word[5]) + 1,
                "l": int(word[6]) + 1,
            }
            for word in raw_words
        ]
        layer: dict[str, object] = {
            "page": page,
            "width": width,
            "height": height,
            "words": words,
        }
        with self._lock:
            self._word_cache[key] = layer
            while len(self._word_cache) > self._words_max:
                self._word_cache.popitem(last=False)
        return layer

    def toc(self, path: Path) -> list[tuple[int, str, int]]:
        try:
            with self._lock:
                doc = self._doc(path)
                entries = doc.get_toc(simple=True) or []
            result: list[tuple[int, str, int]] = []
            for level, title, page in entries:
                if int(page) >= 1:
                    result.append((int(level), str(title), int(page)))
            return result
        except Exception as exc:
            logger.warning("cannot read outline of %s: %s", path.name, exc)
            return []

    def search(
        self, path: Path, query: str, limit: int = 200, *, max_pages: int = 150
    ) -> list[dict[str, object]]:
        needle = query.casefold().strip()
        if not needle:
            return []
        hits: list[dict[str, object]] = []
        start_t = time.monotonic()
        with self._lock:
            doc = self._doc(path)
            total = min(int(doc.page_count), max_pages)
            for index in range(total):
                if len(hits) >= limit or (index > 20 and time.monotonic() - start_t > 1.2):
                    break
                text = " ".join(doc.load_page(index).get_text("text").split())
                position = text.casefold().find(needle)
                if position < 0:
                    continue
                start = max(0, position - SNIPPET_RADIUS)
                end = min(len(text), position + len(needle) + SNIPPET_RADIUS)
                hits.append({"page": index + 1, "snippet": text[start:end]})
        return hits
