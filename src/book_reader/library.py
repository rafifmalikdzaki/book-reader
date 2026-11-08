"""Library scanning and safe path resolution."""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException

BOOK_SUFFIXES = {".pdf", ".md"}
SKIP_DIRS = {"__pycache__", "node_modules", ".venv"}
SCAN_TTL_SECONDS = 30.0
UNFILED = "Unfiled"


@dataclass(frozen=True, slots=True)
class Book:
    rel: str  # POSIX-style path relative to the library root
    title: str  # file stem, verbatim
    kind: str  # "pdf" | "md"
    size: int
    mtime: float


class Library:
    """Read-only view of the library tree, cached for a short TTL."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._lock = threading.Lock()
        self._books: list[Book] = []
        self._scanned_at = 0.0

    def scan(self) -> list[Book]:
        now = time.monotonic()
        with self._lock:
            if self._books and now - self._scanned_at < SCAN_TTL_SECONDS:
                return list(self._books)

        books: list[Book] = []
        for dirpath, dirnames, filenames in os.walk(self.root, followlinks=False):
            dirnames[:] = sorted(
                name for name in dirnames if not name.startswith(".") and name not in SKIP_DIRS
            )
            base = Path(dirpath)
            for name in filenames:
                path = base / name
                suffix = path.suffix.lower()
                if suffix not in BOOK_SUFFIXES:
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                rel = path.relative_to(self.root).as_posix()
                books.append(
                    Book(
                        rel=rel,
                        title=Path(rel).stem,
                        kind=suffix[1:],
                        size=stat.st_size,
                        mtime=stat.st_mtime,
                    )
                )
        books.sort(key=lambda book: book.rel.casefold())
        with self._lock:
            self._books = books
            self._scanned_at = now
        return list(books)

    def groups(self) -> list[tuple[str, list[Book]]]:
        grouped: dict[str, list[Book]] = {}
        for book in self.scan():
            head, separator, _tail = book.rel.partition("/")
            grouped.setdefault(head if separator else UNFILED, []).append(book)
        ordered = sorted((name for name in grouped if name != UNFILED), key=str.casefold)
        result = [(name, grouped[name]) for name in ordered]
        if UNFILED in grouped:
            result.insert(0, (UNFILED, grouped[UNFILED]))
        return result

    def book_file(self, rel: str) -> Path:
        """Resolve a ``.pdf``/``.md`` book path, or raise HTTP 400/404."""
        path = self._resolve(rel)
        if path.suffix.lower() not in BOOK_SUFFIXES:
            raise HTTPException(status_code=400, detail="invalid path")
        return path

    def find_book(self, rel: str) -> Path | None:
        """Resolve a book path, or ``None`` when it is unreadable or unsafe."""
        try:
            return self.book_file(rel)
        except HTTPException:
            return None

    def any_file(self, rel: str) -> Path:
        """Resolve any existing file inside the library, or raise HTTP 400/404."""
        return self._resolve(rel)

    def _resolve(self, rel: str) -> Path:
        if not rel or "\x00" in rel:
            raise HTTPException(status_code=400, detail="invalid path")
        try:
            resolved = (self.root / rel).resolve()
        except (OSError, RuntimeError) as exc:
            raise HTTPException(status_code=400, detail="invalid path") from exc
        if resolved == self.root or not resolved.is_relative_to(self.root):
            raise HTTPException(status_code=400, detail="invalid path")
        if not resolved.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return resolved
