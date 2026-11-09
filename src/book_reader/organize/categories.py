"""Persistent taxonomy and content-hash category assignments (files never move)."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

TAXONOMY_VERSION = 1
CATEGORY_ID = re.compile(r"^[a-z][a-z0-9_-]{1,30}$")


class CategoryRecord(TypedDict):
    id: str
    name: str
    description: str


class Assignment(TypedDict):
    category: str
    confidence: float
    updated: float


class CategoryData(TypedDict):
    version: int
    taxonomy: list[CategoryRecord]
    assignments: dict[str, Assignment]
    generated_at: float


class CategoryStore:
    """Persistent taxonomy and content-hash assignments."""

    def __init__(
        self, state_dir: Path, *, lock: AbstractContextManager[object] | None = None
    ) -> None:
        self.path = Path(state_dir) / "categories.json"
        self._lock = lock or threading.RLock()
        self._data: CategoryData | None = None

    def _load(self) -> CategoryData:
        with self._lock:
            if self._data is None:
                self._data = self._read()
            return self._data

    def _read(self) -> CategoryData:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {
                "version": TAXONOMY_VERSION,
                "taxonomy": [],
                "assignments": {},
                "generated_at": 0.0,
            }
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable categories %s: %s", self.path, exc)
            return {
                "version": TAXONOMY_VERSION,
                "taxonomy": [],
                "assignments": {},
                "generated_at": 0.0,
            }
        raw_taxonomy = raw.get("taxonomy") if isinstance(raw, dict) else None
        raw_assignments = raw.get("assignments") if isinstance(raw, dict) else None
        taxonomy: list[CategoryRecord] = []
        if isinstance(raw_taxonomy, list):
            for item in raw_taxonomy:
                if not isinstance(item, dict):
                    continue
                cid = item.get("id")
                name = item.get("name")
                description = item.get("description", "")
                if isinstance(cid, str) and isinstance(name, str) and CATEGORY_ID.match(cid):
                    taxonomy.append({"id": cid, "name": name, "description": str(description)})
        assignments: dict[str, Assignment] = {}
        if isinstance(raw_assignments, dict):
            valid = {item["id"] for item in taxonomy}
            for digest, item in raw_assignments.items():
                if not isinstance(item, dict):
                    continue
                category = item.get("category")
                if not isinstance(category, str) or category not in valid:
                    continue
                try:
                    confidence = max(0.0, min(1.0, float(item.get("confidence", 0.0))))
                except (TypeError, ValueError):
                    confidence = 0.0
                assignments[str(digest)] = {
                    "category": category,
                    "confidence": confidence,
                    "updated": float(item.get("updated") or 0.0),
                }
        generated = raw.get("generated_at", 0.0) if isinstance(raw, dict) else 0.0
        return {
            "version": TAXONOMY_VERSION,
            "taxonomy": taxonomy,
            "assignments": assignments,
            "generated_at": float(generated) if isinstance(generated, (int, float)) else 0.0,
        }

    def _write(self) -> bool:
        data = self._load()
        payload = {
            "version": TAXONOMY_VERSION,
            "taxonomy": data["taxonomy"],
            "assignments": data["assignments"],
            "generated_at": data["generated_at"],
        }
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist categories %s: %s", self.path, exc)
            return False
        return True

    def taxonomy(self) -> list[CategoryRecord]:
        return [dict(item) for item in self._load()["taxonomy"]]  # type: ignore[misc]

    def assignments(self) -> dict[str, Assignment]:
        return dict(self._load()["assignments"])

    def category_for(self, content_id: str) -> CategoryRecord | None:
        assignment = self.assignments().get(content_id)
        if assignment is None:
            return None
        return next(
            (item for item in self.taxonomy() if item["id"] == assignment["category"]),
            None,
        )

    def save_taxonomy(self, taxonomy: list[CategoryRecord]) -> None:
        with self._lock:
            data = self._load()
            data["taxonomy"] = taxonomy
            data["generated_at"] = time.time()
            self._write()

    def save_assignments(self, assignments: dict[str, Assignment]) -> None:
        if not assignments:
            return
        with self._lock:
            data = self._load()
            data["assignments"].update(assignments)
            self._write()
