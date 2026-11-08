"""Persistence for reading positions."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path

from .statemove import RemapError, apply_remap, plan_remap

logger = logging.getLogger(__name__)

Entry = dict[str, object]


class ProgressStore:
    """JSON-backed store of per-book reading positions.

    Schema on disk::

        {"version": 1, "books": {"<rel>": {"page": 12, "scroll": null, "updated": 1762500000.0}}}
    """

    def __init__(
        self, state_dir: Path, *, lock: AbstractContextManager[object] | None = None
    ) -> None:
        self.state_dir = Path(state_dir)
        self.path = self.state_dir / "progress.json"
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._books: dict[str, Entry] | None = None

    def _load(self) -> dict[str, Entry]:
        with self._lock:
            if self._books is None:
                self._books = self._read()
            return self._books

    def _read(self) -> dict[str, Entry]:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable progress file %s: %s", self.path, exc)
            return {}
        books = raw.get("books") if isinstance(raw, dict) else None
        if not isinstance(books, dict):
            return {}
        return {str(rel): dict(entry) for rel, entry in books.items() if isinstance(entry, dict)}

    def reload(self) -> None:
        """Drop the in-memory copy so the next read comes from disk."""
        with self._lock:
            self._books = None

    def get(self, rel: str) -> Entry | None:
        entry = self._load().get(rel)
        if entry is None:
            return None
        return {
            "page": entry.get("page"),
            "scroll": entry.get("scroll"),
            "updated": float(str(entry.get("updated") or 0.0)),
        }

    def update(self, rel: str, *, page: int | None = None, scroll: float | None = None) -> None:
        with self._lock:
            books = self._load()
            entry: Entry = dict(books.get(rel) or {})
            if page is not None:
                entry["page"] = int(page)
            if scroll is not None:
                entry["scroll"] = round(float(scroll), 4)
            entry.setdefault("page", None)
            entry.setdefault("scroll", None)
            entry["updated"] = time.time()
            books[rel] = entry
            self._write(books)

    def remap(self, mapping: dict[str, str]) -> set[str]:
        """Move saved positions from old paths to their new locations.

        Returns the old paths whose target already had a position; those are
        left untouched rather than overwriting the newer history. Swaps are
        applied simultaneously from the same snapshot.
        """
        if not mapping:
            return set()
        with self._lock:
            books = self._load()
            safe, conflicts = plan_remap(mapping, set(books))
            if safe:
                moved = apply_remap(books, safe)
                if not self._write(moved):
                    raise RemapError(f"cannot persist reading progress to {self.path}")
                self._books = moved
        return conflicts

    def _write(self, books: dict[str, Entry]) -> bool:
        payload = {"version": 1, "books": books}
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist reading progress to %s: %s", self.path, exc)
            return False
        return True

    def recent(self, limit: int = 5) -> list[tuple[str, Entry]]:
        with self._lock:
            snapshot = dict(self._load())
        ordered = sorted(
            snapshot.items(),
            key=lambda item: float(str(item[1].get("updated") or 0.0)),
            reverse=True,
        )
        return [
            (
                rel,
                {
                    "page": entry.get("page"),
                    "scroll": entry.get("scroll"),
                    "updated": float(str(entry.get("updated") or 0.0)),
                },
            )
            for rel, entry in ordered[:limit]
        ]
