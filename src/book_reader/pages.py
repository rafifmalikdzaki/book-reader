"""Persisted PDF page-count index."""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Iterable
from contextlib import AbstractContextManager
from pathlib import Path

from .pdf import PdfCache
from .statemove import RemapError, apply_remap, plan_remap

logger = logging.getLogger(__name__)


class PageIndex:
    """Page counts keyed by ``rel`` plus the file's mtime and size.

    Opening a PDF is the expensive part of the library index, so each result —
    including a failure (``None``) — is reused until the file changes.
    """

    def __init__(
        self,
        state_dir: Path,
        pdf: PdfCache,
        *,
        lock: AbstractContextManager[object] | None = None,
    ) -> None:
        self.path = Path(state_dir) / "pages.json"
        self._pdf = pdf
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._entries: dict[str, dict[str, object]] = {}
        self._loaded = False

    def _load(self) -> dict[str, dict[str, object]]:
        with self._lock:
            if not self._loaded:
                self._entries = self._read()
                self._loaded = True
            return self._entries

    def _read(self) -> dict[str, dict[str, object]]:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable page index %s: %s", self.path, exc)
            return {}
        books = raw.get("books") if isinstance(raw, dict) else None
        if not isinstance(books, dict):
            return {}
        return {str(rel): entry for rel, entry in books.items() if isinstance(entry, dict)}

    def reload(self) -> None:
        with self._lock:
            self._entries = {}
            self._loaded = False

    def count(self, rel: str, path: Path) -> int | None:
        return self.counts([(rel, path)])[rel]

    def counts(self, items: Iterable[tuple[str, Path]]) -> dict[str, int | None]:
        """Page counts for ``(rel, path)`` pairs, writing the index at most once."""
        meta = self.counts_and_titles(items)
        return {rel: pages for rel, (pages, _) in meta.items()}

    def counts_and_titles(
        self, items: Iterable[tuple[str, Path]]
    ) -> dict[str, tuple[int | None, str | None]]:
        """Page counts and titles for ``(rel, path)`` pairs, writing the index at most once."""
        with self._lock:
            entries = self._load()
            result: dict[str, tuple[int | None, str | None]] = {}
            dirty = False
            for rel, path in items:
                try:
                    stat = path.stat()
                except OSError:
                    result[rel] = (None, None)
                    continue
                entry = entries.get(rel)
                if (
                    entry is not None
                    and entry.get("mtime") == stat.st_mtime
                    and entry.get("size") == stat.st_size
                    and "title" in entry
                ):
                    pages = entry.get("pages")
                    title = entry.get("title")
                    result[rel] = (
                        pages if isinstance(pages, int) else None,
                        str(title) if isinstance(title, str) and title else None,
                    )
                    continue
                pages_val = self._open(rel, path)
                title_val = self._open_title(rel, path)
                entries[rel] = {
                    "mtime": stat.st_mtime,
                    "size": stat.st_size,
                    "pages": pages_val,
                    "title": title_val,
                }
                result[rel] = (pages_val, title_val)
                dirty = True
            if dirty:
                self._write(entries)
            return result

    def _open(self, rel: str, path: Path) -> int | None:
        try:
            return self._pdf.page_count(path)
        except Exception as exc:
            logger.warning("cannot read %s: %s", rel, exc)
            return None

    def _open_title(self, rel: str, path: Path) -> str | None:
        try:
            return self._pdf.title(path)
        except Exception as exc:
            logger.warning("cannot read title of %s: %s", rel, exc)
            return None

    def remap(self, mapping: dict[str, str]) -> set[str]:
        """Move cached page counts to new paths, applying swaps at once."""
        if not mapping:
            return set()
        with self._lock:
            entries = self._load()
            safe, conflicts = plan_remap(mapping, set(entries))
            if safe:
                moved = apply_remap(entries, safe)
                if not self._write(moved):
                    raise RemapError(f"cannot persist page counts to {self.path}")
                self._entries = moved
        return conflicts

    def _write(self, entries: dict[str, dict[str, object]]) -> bool:
        payload = {"version": 1, "books": entries}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist page index to %s: %s", self.path, exc)
            return False
        return True
