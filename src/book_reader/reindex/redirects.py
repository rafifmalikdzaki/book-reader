"""Where a moved book lives now: the old-path -> new-path log and the lookup built on it."""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING

from ..library.scan import Library

if TYPE_CHECKING:
    from .reconciler import LibraryReconciler

logger = logging.getLogger(__name__)

MOVES_VERSION = 1
MOVE_HISTORY_LIMIT = 2000


class MoveLog:
    """Old path -> current path, compressed so a chain settles on the last URL."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._moves: dict[str, str] | None = None

    def _load(self) -> dict[str, str]:
        with self._lock:
            if self._moves is None:
                try:
                    raw: object = json.loads(self.path.read_text(encoding="utf-8"))
                except FileNotFoundError:
                    raw = {}
                except (OSError, json.JSONDecodeError) as exc:
                    logger.warning("ignoring unreadable move log %s: %s", self.path, exc)
                    raw = {}
                moves = raw.get("moves") if isinstance(raw, dict) else None
                self._moves = {
                    str(old): str(new)
                    for old, new in (moves.items() if isinstance(moves, dict) else [])
                    if isinstance(old, str) and isinstance(new, str) and old != new
                }
            return self._moves

    def record(self, pairs: dict[str, str]) -> bool:
        if not pairs:
            return True
        with self._lock:
            moves = self._load()
            for old, new in pairs.items():
                if old == new:
                    continue
                for key, value in list(moves.items()):
                    if value == old:
                        moves[key] = new
                moves[old] = new
            while len(moves) > MOVE_HISTORY_LIMIT:
                moves.pop(next(iter(moves)))
            return self._save(moves)

    def reload(self) -> None:
        with self._lock:
            self._moves = None

    def resolve(self, rel: str) -> str:
        """Follow a recorded rename chain; returns ``rel`` when unknown."""
        with self._lock:
            moves = self._load()
            current = rel
            seen = {rel}
            for _ in range(32):
                nxt = moves.get(current)
                if not nxt or nxt in seen:
                    break
                seen.add(nxt)
                current = nxt
            return current

    def _save(self, moves: dict[str, str]) -> bool:
        payload = {"version": MOVES_VERSION, "moves": moves}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist move log %s: %s", self.path, exc)
            return False
        return True


def moved_book_target(rel: str, *, library: Library, reconciler: LibraryReconciler) -> str | None:
    """The book's new path if a reindex shows ``rel`` moved, else ``None``."""
    try:
        reconciler.sync()
    except Exception:
        logger.exception("reindex failed while resolving a moved book")
    moved = reconciler.resolve(rel)
    if moved != rel and library.find_book(moved) is not None:
        return moved
    return None
