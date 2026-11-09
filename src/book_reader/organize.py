"""Mistral + PageIndex categorization for the local library.

Categories are virtual and keyed by the same SHA-256 content identity used by
the reindexer. No file is moved. The organizer only sends a document's title,
section headings, and a short first-page excerpt to Mistral after the UI
confirms that request.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Protocol, TypedDict

import httpx

from .library.models import UNFILED
from .library.scan import Library
from .reading.pdf import PdfCache
from .reading.sections import SectionIndex
from .reconcile import LibraryReconciler

logger = logging.getLogger(__name__)

TAXONOMY_VERSION = 1
CATEGORY_ID = re.compile(r"^[a-z][a-z0-9_-]{1,30}$")
BATCH_SIZE = 20
TAXONOMY_SAMPLE = 40
MAX_TAXONOMY_CHARS = 18_000
MAX_BATCH_CHARS = 12_000


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


class JSONClient(Protocol):
    def json(self, system: str, user: str) -> dict[str, object] | None: ...


class MistralClient:
    """Minimal JSON-mode client for the user's configured Mistral key."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "mistral-small-latest",
        base_url: str = "https://api.mistral.ai/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    @classmethod
    def from_env(cls) -> MistralClient | None:
        key = (os.environ.get("MISTRAL_API_KEY") or os.environ.get("MISTRAL_API") or "").strip()
        if not key:
            return None
        return cls(
            key,
            model=os.environ.get("BOOK_READER_MISTRAL_MODEL", "mistral-small-latest"),
            base_url=os.environ.get("BOOK_READER_MISTRAL_BASE_URL", "https://api.mistral.ai/v1"),
        )

    def json(self, system: str, user: str) -> dict[str, object] | None:
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        for attempt in range(3):
            try:
                response = httpx.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                    timeout=90,
                )
                if response.status_code == 400 and "response_format" in response.text:
                    payload.pop("response_format", None)
                    response = httpx.post(
                        f"{self.base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                        timeout=90,
                    )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                return _decode_json(str(content))
            except Exception as exc:
                logger.warning("mistral organize attempt %d failed: %s", attempt + 1, exc)
                time.sleep(1.2 * (attempt + 1))
        return None


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


def _decode_json(content: str) -> dict[str, object] | None:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


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
