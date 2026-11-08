"""PDF document cache: page rendering, text search, table of contents."""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from pathlib import Path

import pymupdf

logger = logging.getLogger(__name__)

SNIPPET_RADIUS = 60


class PdfCache:
    """A small LRU of open PyMuPDF documents.

    PyMuPDF documents are not thread-safe, so every operation holds ``_lock``
    for its entire body. FastAPI runs the sync endpoints in a threadpool, hence
    the lock rather than relying on the event loop.
    """

    def __init__(self, max_open: int = 3) -> None:
        self._max_open = max(1, max_open)
        self._lock = threading.RLock()
        self._docs: OrderedDict[tuple[str, float], pymupdf.Document] = OrderedDict()

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

    def render(self, path: Path, page: int, zoom: float) -> bytes:
        with self._lock:
            doc = self._doc(path)
            if not 1 <= page <= doc.page_count:
                raise ValueError(f"page out of range: {page}")
            pixmap = doc.load_page(page - 1).get_pixmap(
                matrix=pymupdf.Matrix(zoom, zoom), alpha=False
            )
            return bytes(pixmap.tobytes("png"))

    def page_text(self, path: Path, page: int) -> str:
        with self._lock:
            doc = self._doc(path)
            if not 1 <= page <= doc.page_count:
                raise ValueError(f"page out of range: {page}")
            return str(doc.load_page(page - 1).get_text("text"))

    def page_words(self, path: Path, page: int) -> dict[str, object]:
        """Words with bounding boxes for the selectable text layer."""
        with self._lock:
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
            }
            for word in raw_words
        ]
        return {"page": page, "width": width, "height": height, "words": words}

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

    def search(self, path: Path, query: str, limit: int = 200) -> list[dict[str, object]]:
        needle = query.casefold().strip()
        if not needle:
            return []
        hits: list[dict[str, object]] = []
        with self._lock:
            doc = self._doc(path)
            for index in range(doc.page_count):
                if len(hits) >= limit:
                    break
                text = " ".join(doc.load_page(index).get_text("text").split())
                position = text.casefold().find(needle)
                if position < 0:
                    continue
                start = max(0, position - SNIPPET_RADIUS)
                end = min(len(text), position + len(needle) + SNIPPET_RADIUS)
                hits.append({"page": index + 1, "snippet": text[start:end]})
        return hits
