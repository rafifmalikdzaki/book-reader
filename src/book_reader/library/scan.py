"""Library scanning and safe path resolution."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from .errors import InvalidPath, LibraryError, PathNotFound
from .models import UNFILED, Book

BOOK_SUFFIXES = {".pdf", ".md"}
SKIP_DIRS = {"__pycache__", "node_modules", ".venv"}
# A folder holding one of these and no PDF of its own is a source checkout (this app's own
# repository, say), not a shelf: its design notes are not books. A book kept beside its
# code samples still counts as a shelf.
PROJECT_MARKERS = ("pyproject.toml", "package.json", "Cargo.toml", "go.mod")
# Repository scaffolding, often an empty placeholder: never a book.
SKIP_FILES = {"readme.md"}
SCAN_TTL_SECONDS = 30.0


def _skipped(parent: Path, name: str) -> bool:
    if name.startswith(".") or name in SKIP_DIRS:
        return True
    folder = parent / name
    if not any((folder / marker).is_file() for marker in PROJECT_MARKERS):
        return False
    try:
        return not any(entry.lower().endswith(".pdf") for entry in os.listdir(folder))
    except OSError:
        return True


class Library:
    """Read-only view of the library tree, cached for a short TTL."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._lock = threading.Lock()
        self._books: list[Book] = []
        self._scanned_at = 0.0

    def scan(self, *, force: bool = False) -> list[Book]:
        now = time.monotonic()
        with self._lock:
            if not force and self._books and now - self._scanned_at < SCAN_TTL_SECONDS:
                return list(self._books)

        books: list[Book] = []
        for dirpath, dirnames, filenames in os.walk(self.root, followlinks=False):
            base = Path(dirpath)
            dirnames[:] = sorted(name for name in dirnames if not _skipped(base, name))
            for name in filenames:
                path = base / name
                suffix = path.suffix.lower()
                if suffix not in BOOK_SUFFIXES or name.lower() in SKIP_FILES:
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
        """Resolve a ``.pdf``/``.md`` book path, or raise ``InvalidPath``/``PathNotFound``."""
        path = self._resolve(rel)
        if path.suffix.lower() not in BOOK_SUFFIXES:
            raise InvalidPath
        return path

    def find_book(self, rel: str) -> Path | None:
        """Resolve a book path, or ``None`` when it is unreadable or unsafe."""
        try:
            return self.book_file(rel)
        except LibraryError:
            return None

    def any_file(self, rel: str) -> Path:
        """Resolve any existing file inside the library, or raise ``InvalidPath``/``PathNotFound``.

        Hidden non-book files (``.env``, ``.DS_Store``) are treated as missing, like
        the hidden directories the scan skips. Hidden ``.pdf``/``.md`` files stay
        reachable because the scan lists them as books.
        """
        path = self._resolve(rel)
        if path.name.startswith(".") and path.suffix.lower() not in BOOK_SUFFIXES:
            raise PathNotFound
        return path

    def _resolve(self, rel: str) -> Path:
        if not rel or "\x00" in rel:
            raise InvalidPath
        try:
            resolved = (self.root / rel).resolve()
        except (OSError, RuntimeError) as exc:
            raise InvalidPath from exc
        if resolved == self.root or not resolved.is_relative_to(self.root):
            raise InvalidPath
        # Same directory filter as scan(): a direct URL must not reach what the index hides.
        # Checked after resolve(), so ``a/../.hidden/x`` and symlinks into hidden dirs are caught.
        parent = self.root
        for part in resolved.relative_to(self.root).parts[:-1]:
            if _skipped(parent, part):
                raise PathNotFound
            parent = parent / part
        if resolved.name.lower() in SKIP_FILES:
            raise PathNotFound
        if not resolved.is_file():
            raise PathNotFound
        return resolved
