"""Section localization from PageIndex Flash layout trees (no LLM required)."""

from __future__ import annotations

import json
import logging
import os
import threading
from contextlib import AbstractContextManager
from pathlib import Path
from typing import TypedDict

from .statemove import RemapError, apply_remap, plan_remap

logger = logging.getLogger(__name__)


class Section(TypedDict):
    title: str
    start_page: int
    end_page: int
    depth: int


class SectionIndex:
    """Per-document section trees, cached on disk by file mtime and size.

    Uses PageIndex's Flash pipeline (``pageindex.flash.main.extract_toc``),
    which reads the PDF layout directly and needs no model or API key. The
    optional dependency is imported lazily: without it, sections are empty and
    the reader keeps working.
    """

    def __init__(
        self, state_dir: Path, *, lock: AbstractContextManager[object] | None = None
    ) -> None:
        self.path = Path(state_dir) / "sections.json"
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._cache: dict[str, dict[str, object]] | None = None
        self._available: bool | None = None

    def available(self) -> bool:
        with self._lock:
            if self._available is None:
                try:
                    from pageindex.flash.main import extract_toc  # noqa: F401
                except Exception as exc:
                    logger.info("PageIndex Flash unavailable: %s", exc)
                    self._available = False
                else:
                    self._available = True
            return self._available

    def _load(self) -> dict[str, dict[str, object]]:
        with self._lock:
            if self._cache is None:
                self._cache = self._read()
            return self._cache

    def _read(self) -> dict[str, dict[str, object]]:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable section cache %s: %s", self.path, exc)
            return {}
        books = raw.get("books") if isinstance(raw, dict) else None
        if not isinstance(books, dict):
            return {}
        return {str(rel): entry for rel, entry in books.items() if isinstance(entry, dict)}

    def remap(self, mapping: dict[str, str]) -> set[str]:
        """Move cached section trees with their books, including swaps."""
        if not mapping:
            return set()
        with self._lock:
            entries = self._load()
            safe, conflicts = plan_remap(mapping, set(entries))
            if safe:
                moved = apply_remap(entries, safe)
                previous = self._cache
                self._cache = moved
                if not self._write():
                    self._cache = previous
                    raise RemapError(f"cannot persist section cache to {self.path}")
        return conflicts

    def _write(self) -> bool:
        payload = {"version": 1, "books": self._load()}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist section cache to %s: %s", self.path, exc)
            return False
        return True

    def reload(self) -> None:
        with self._lock:
            self._cache = None

    def sections(self, rel: str, path: Path) -> list[Section]:
        if path.suffix.lower() != ".pdf" or not self.available():
            return []
        try:
            stat = path.stat()
        except OSError:
            return []
        with self._lock:
            entry = self._load().get(rel)
            if _entry_is_current(entry, stat):
                decoded = _decode_sections(entry.get("sections") if entry else None)
                if decoded is not None:
                    return decoded

        sections: list[Section] = []
        try:
            from pageindex.flash.main import extract_toc

            result = extract_toc(str(path))
            sections = _flatten(result.get("structure") or [])
        except Exception as exc:
            logger.warning("pageindex could not read %s: %s", rel, exc)
        with self._lock:
            entries = self._load()
            current = entries.get(rel)
            if _entry_is_current(current, stat):
                decoded = _decode_sections(current.get("sections") if current else None)
                if decoded is not None:
                    return decoded
            entries[rel] = {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "sections": sections,
            }
            self._write()
        return sections

    def cached(self, rel: str) -> list[Section]:
        """Sections already on disk for ``rel``, without running extraction."""
        entry = self._load().get(rel)
        decoded = _decode_sections(entry.get("sections") if entry else None)
        return decoded or []

    def cached_section_for_page(self, rel: str, page: int) -> str:
        """Deepest cached section containing ``page``; never triggers extraction."""
        match = ""
        for section in self.cached(rel):
            if section["start_page"] <= page <= section["end_page"]:
                match = section["title"]
        return match

    def cached_books(self) -> list[str]:
        return sorted(
            (rel for rel, entry in self._load().items() if entry.get("sections")),
            key=str.casefold,
        )

    def section_for_page(self, rel: str, path: Path, page: int) -> str:
        match = ""
        for section in self.sections(rel, path):
            if section["start_page"] <= page <= section["end_page"]:
                match = section["title"]
        return match


def _decode_sections(cached: object) -> list[Section] | None:
    if not isinstance(cached, list):
        return None
    return [
        section for section in (_coerce_section(item) for item in cached) if section is not None
    ]


def _entry_is_current(entry: dict[str, object] | None, stat: os.stat_result) -> bool:
    return (
        entry is not None
        and entry.get("mtime") == stat.st_mtime
        and entry.get("size") == stat.st_size
    )


def _coerce_section(node: object) -> Section | None:
    if not isinstance(node, dict):
        return None
    title = node.get("title")
    start = node.get("start_page")
    end = node.get("end_page")
    depth = node.get("depth", 0)
    if not isinstance(title, str) or not isinstance(start, int) or not isinstance(end, int):
        return None
    return {
        "title": title,
        "start_page": start,
        "end_page": end,
        "depth": depth if isinstance(depth, int) else 0,
    }


def _flatten(structure: list[dict[str, object]], depth: int = 0) -> list[Section]:
    sections: list[Section] = []
    for node in structure:
        title = str(node.get("title") or "").strip()
        start = node.get("start_index")
        end = node.get("end_index")
        if title and isinstance(start, int) and isinstance(end, int) and end >= start:
            sections.append({"title": title, "start_page": start, "end_page": end, "depth": depth})
        children = node.get("nodes")
        if isinstance(children, list):
            sections.extend(_flatten(children, depth + 1))
    return sections
