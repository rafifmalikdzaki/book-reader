"""LibraryOrganizer: the background job that asks Mistral to categorize the library."""

from __future__ import annotations

import contextlib
import json
import logging
import re
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path

from ..library.models import UNFILED
from ..library.scan import Library
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from ..reconcile import LibraryReconciler
from .categories import (
    CATEGORY_ID,
    Assignment,
    CategoryRecord,
    CategoryStore,
)
from .mistral import JSONClient

logger = logging.getLogger(__name__)

BATCH_SIZE = 20
TAXONOMY_SAMPLE = 40
MAX_TAXONOMY_CHARS = 18_000
MAX_BATCH_CHARS = 12_000


class LibraryOrganizer:
    def __init__(
        self,
        library: Library,
        pdf: PdfCache,
        sections: SectionIndex,
        reconciler: LibraryReconciler,
        categories: CategoryStore,
        mistral: JSONClient | None,
        *,
        lock: AbstractContextManager[object] | None = None,
    ) -> None:
        self.library = library
        self.pdf = pdf
        self.sections = sections
        self.reconciler = reconciler
        self.categories = categories
        self.mistral = mistral
        self._state_lock = threading.Lock()
        self._status: dict[str, object] = {
            "running": False,
            "phase": "idle",
            "done": 0,
            "total": 0,
            "error": "",
            "available": mistral is not None,
            "started": 0.0,
        }

    @property
    def available(self) -> bool:
        return self.mistral is not None

    def status(self) -> dict[str, object]:
        with self._state_lock:
            status = dict(self._status)
        status["taxonomy"] = self.categories.taxonomy()
        status["assignments"] = len(self.categories.assignments())
        return status

    def start(self, *, force_taxonomy: bool = False) -> bool:
        if self.mistral is None:
            return False
        with self._state_lock:
            if self._status["running"]:
                return False
            self._status.update(
                {
                    "running": True,
                    "phase": "starting",
                    "done": 0,
                    "total": 0,
                    "error": "",
                    "started": time.time(),
                }
            )
        thread = threading.Thread(
            target=self._run,
            args=(force_taxonomy,),
            name="book-reader-organizer",
            daemon=True,
        )
        thread.start()
        return True

    def _set(self, **values: object) -> None:
        with self._state_lock:
            self._status.update(values)

    def _run(self, force_taxonomy: bool) -> None:
        try:
            self.reconciler.sync()
            books = self.library.scan()
            self._set(total=len(books), phase="sections")
            signals: list[dict[str, object]] = []
            for index, book in enumerate(books):
                path = self.library.find_book(book.rel)
                digest = self.reconciler.content_id(book.rel)
                if path is None or not digest:
                    self._set(done=index + 1)
                    continue
                signals.append(self._signal(book.rel, path, book.kind, digest))
                self._set(done=index + 1)

            self._set(phase="taxonomy")
            taxonomy = self.categories.taxonomy()
            if not taxonomy or force_taxonomy:
                taxonomy = self._make_taxonomy(signals)
                if not taxonomy:
                    raise RuntimeError("Mistral could not produce a taxonomy")
                self.categories.save_taxonomy(taxonomy)

            self._set(phase="assign", done=0, total=len(signals))
            self._assign(signals, taxonomy)
            self._set(
                running=False,
                phase="done",
                error="",
                done=len(signals),
                total=len(signals),
            )
        except Exception as exc:
            logger.exception("library organizer failed")
            self._set(running=False, phase="error", error=str(exc))

    def _signal(self, rel: str, path: Path, kind: str, digest: str) -> dict[str, object]:
        title = path.stem
        excerpt = ""
        headings: list[str] = []
        if kind == "pdf":
            with contextlib.suppress(Exception):
                title = self.pdf.title(path) or title
            with contextlib.suppress(Exception):
                sections = self.sections.sections(rel, path)
                headings = [item["title"] for item in sections if item["depth"] == 0][:8]
                if not headings:
                    headings = [item["title"] for item in sections][:8]
            with contextlib.suppress(Exception):
                excerpt = self.pdf.page_text(path, 1)[:500]
        else:
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                text = ""
            match = re.search(r"^#\s+(.+?)\s*#*$", text, re.MULTILINE)
            if match:
                title = match.group(1).strip()
            headings = [
                line.lstrip("#").strip() for line in text.splitlines() if line.startswith("#")
            ][:8]
            excerpt = " ".join(text.split())[:500]
        shelf = rel.partition("/")[0] if "/" in rel else UNFILED
        return {
            "id": digest,
            "title": " ".join(title.split())[:160],
            "kind": kind,
            "shelf": shelf,
            "headings": headings,
            "excerpt": " ".join(excerpt.split())[:500],
        }

    def _make_taxonomy(self, signals: list[dict[str, object]]) -> list[CategoryRecord]:
        sample = _fit_documents(_sample_signals(signals, TAXONOMY_SAMPLE), MAX_TAXONOMY_CHARS)
        payload = json.dumps({"documents": sample}, ensure_ascii=False)
        prompt = (
            "Propose 5 to 10 flat categories for this researcher's personal technical library. "
            "Use the document titles, PageIndex section headings, and excerpts. Return JSON only: "
            '{"categories":[{"id":"lower_snake_case","name":"Display Name",'
            '"description":"one line"}]}. '
            "IDs must match ^[a-z][a-z0-9_-]{1,30}$ and names must be unique."
        )
        if self.mistral is None:
            return []
        result = self.mistral.json(prompt, payload)
        taxonomy = _taxonomy_from_result(result)
        if taxonomy:
            return taxonomy
        logger.warning("Mistral taxonomy failed; falling back to folders")
        return _folder_taxonomy(signals)

    def _assign(self, signals: list[dict[str, object]], taxonomy: list[CategoryRecord]) -> None:
        if self.mistral is None:
            raise RuntimeError("Mistral is not configured")
        valid = {item["id"] for item in taxonomy}
        existing = self.categories.assignments()
        pending = [
            signal
            for signal in signals
            if signal["id"] not in existing or existing[str(signal["id"])]["category"] not in valid
        ]
        if not pending:
            return
        system = (
            "Assign every supplied document to exactly one category from this taxonomy. "
            'Return JSON only: {"assignments":[{"id":"document id","category":"category id",'
            '"confidence":0.0}]}. Do not invent category ids. Confidence is 0..1.\\n'
            + json.dumps(taxonomy, ensure_ascii=False)
        )
        done = 0
        offset = 0
        while offset < len(pending):
            batch = _fit_documents(pending[offset : offset + BATCH_SIZE], MAX_BATCH_CHARS)
            if not batch:
                raise RuntimeError("a document was too large to classify")
            user = json.dumps({"documents": batch}, ensure_ascii=False)
            result = self.mistral.json(system, user)
            if not result:
                raise RuntimeError("Mistral assignment request failed")
            assignments: dict[str, Assignment] = {}
            batch_ids = {str(item["id"]) for item in batch}
            now = time.time()
            raw_items = result.get("assignments")
            if not isinstance(raw_items, list):
                raw_items = []
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                digest = item.get("id")
                category = item.get("category")
                if not isinstance(digest, str) or not isinstance(category, str):
                    continue
                if category not in valid or digest not in batch_ids:
                    continue
                try:
                    confidence = max(0.0, min(1.0, float(item.get("confidence", 0.0))))
                except (TypeError, ValueError):
                    confidence = 0.0
                assignments[digest] = {
                    "category": category,
                    "confidence": confidence,
                    "updated": now,
                }
            self.categories.save_assignments(assignments)
            offset += len(batch)
            done += len(batch)
            self._set(done=done)


def _taxonomy_from_result(result: dict[str, object] | None) -> list[CategoryRecord]:
    if not result:
        return []
    raw = result.get("categories")
    if not isinstance(raw, list):
        return []
    taxonomy: list[CategoryRecord] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        cid = item.get("id")
        name = item.get("name")
        if not isinstance(cid, str) or not isinstance(name, str):
            continue
        cid = cid.strip().lower()
        name = " ".join(name.split())
        if not CATEGORY_ID.match(cid) or cid in seen or not name:
            continue
        seen.add(cid)
        taxonomy.append(
            {"id": cid, "name": name[:60], "description": str(item.get("description", ""))[:200]}
        )
    return taxonomy if 3 <= len(taxonomy) <= 12 else []


def _folder_taxonomy(signals: list[dict[str, object]]) -> list[CategoryRecord]:
    names: list[str] = []
    for signal in signals:
        shelf = str(signal.get("shelf") or "")
        if shelf and shelf not in names:
            names.append(shelf)
    if not names:
        names = [UNFILED]
    taxonomy: list[CategoryRecord] = []
    seen: set[str] = set()
    for name in names[:12]:
        cid = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or "unsorted"
        cid = cid[:31]
        if cid in seen:
            continue
        seen.add(cid)
        taxonomy.append({"id": cid, "name": name, "description": "Folder category"})
    return taxonomy


def _fit_documents(documents: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    fitted: list[dict[str, object]] = []
    for document in documents:
        candidate = [*fitted, document]
        if len(json.dumps({"documents": candidate}, ensure_ascii=False)) > limit:
            if not fitted:
                compact = dict(document)
                headings = compact.get("headings")
                compact["headings"] = headings[:3] if isinstance(headings, list) else []
                compact["excerpt"] = str(compact.get("excerpt", ""))[:200]
                compact["title"] = str(compact.get("title", ""))[:80]
                candidate = [compact]
                if len(json.dumps({"documents": candidate}, ensure_ascii=False)) > limit:
                    return []
                fitted = candidate
                break
            break
        fitted = candidate
    return fitted


def _sample_signals(signals: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    sample: list[dict[str, object]] = []
    seen: set[str] = set()
    for signal in signals:
        key = str(signal.get("title") or "").casefold()
        if key and key not in seen:
            sample.append(signal)
            seen.add(key)
        if len(sample) >= limit:
            break
    return sample
