"""Reindex a reorganized library by content, not by file name.

A local library is a folder people move, rename, and reorganize. Saved state
(reading positions, notes, page counts, section trees) is keyed by the path a
book had when it was read. This module records a content hash for every book in
a manifest and, on the next reindex, matches paths that disappeared with paths
that appeared by that hash. Matches are then migrated through every store.

The rules are deliberately conservative:

* only content (SHA-256) decides a move; a path is never guessed from a name;
* one hash must map to exactly one vanished and one appeared file, otherwise
  the pair is left alone;
* state is copied to ``state/backups/reindex-<timestamp>/`` before migration;
* a target that already has state is never overwritten (the conflict is
  reported and the old value remains recoverable in the backup);
* a manifest entry is kept after its book disappears, so restoring the same
  content later under a different name can still recover its state.

Nothing here writes into the library itself; it only reads books and rewrites
the app's state directory.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import threading
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .chats import ChatStore
from .library.scan import Library
from .notepad import NotepadStore
from .reading.pages import PageIndex
from .reading.progress import ProgressStore
from .reading.sections import SectionIndex

logger = logging.getLogger(__name__)

MANIFEST_VERSION = 1
MOVES_VERSION = 1
MOVE_HISTORY_LIMIT = 2000
HASH_CHUNK = 1024 * 1024
STATE_FILES = (
    "progress.json",
    "notepad.json",
    "chats.json",
    "pages.json",
    "sections.json",
    "library_manifest.json",
    "relocations.json",
    "last_reindex.json",
)


@dataclass(slots=True)
class FileStamp:
    """The identity of one file: content hash plus cheap stat metadata."""

    hash: str
    size: int
    mtime_ns: int
    dev: int
    ino: int
    present: bool = True
    retired: bool = False

    def signature(self) -> tuple[int, int, int, int]:
        return (self.dev, self.ino, self.size, self.mtime_ns)

    def to_json(self) -> dict[str, object]:
        return {
            "hash": self.hash,
            "size": self.size,
            "mtime_ns": self.mtime_ns,
            "dev": self.dev,
            "ino": self.ino,
            "present": self.present,
            "retired": self.retired,
        }

    @classmethod
    def from_json(cls, value: object) -> FileStamp | None:
        if not isinstance(value, dict):
            return None
        digest = value.get("hash")
        if not isinstance(digest, str) or len(digest) != 64:
            return None
        try:
            return cls(
                hash=digest,
                size=int(str(value.get("size") or 0)),
                mtime_ns=int(str(value.get("mtime_ns") or 0)),
                dev=int(str(value.get("dev") or 0)),
                ino=int(str(value.get("ino") or 0)),
                present=bool(value.get("present", True)),
                retired=bool(value.get("retired", False)),
            )
        except (TypeError, ValueError):
            return None


@dataclass(slots=True)
class ReindexReport:
    moved: dict[str, str] = field(default_factory=dict)
    conflicts: list[dict[str, str]] = field(default_factory=list)
    added: int = 0
    missing: int = 0
    hashed: int = 0
    backed_up: str | None = None
    failed: list[str] = field(default_factory=list)
    recovered: bool = False

    @property
    def count(self) -> int:
        return len(self.moved)

    def notice(self) -> str:
        if self.failed:
            stores = ", ".join(self.failed)
            return (
                f"Reindex incomplete: could not save {stores}. Nothing was discarded;"
                " the state backup is intact and it will retry next time."
            )
        if self.recovered and not self.moved:
            return "Recovered an interrupted reindex; saved state is consistent."
        if self.moved:
            books = "book" if self.count == 1 else "books"
            text = f"Library reorganized: {self.count} {books} kept their notes and place."
        else:
            text = ""
        if self.conflicts:
            suffix = (
                f" {len(self.conflicts)} saved position"
                f"{'' if len(self.conflicts) == 1 else 's'} already had a newer entry;"
                " the previous copy is in the state backup."
            )
            text += suffix
        return text.strip()

    def as_dict(self) -> dict[str, object]:
        return {
            "moved": dict(self.moved),
            "conflicts": list(self.conflicts),
            "added": self.added,
            "missing": self.missing,
            "hashed": self.hashed,
            "backed_up": self.backed_up,
            "failed": list(self.failed),
            "recovered": self.recovered,
            "notice": self.notice(),
        }


class _MoveLog:
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


class LibraryReconciler:
    """Keep saved state attached when books are moved or renamed."""

    def __init__(
        self,
        library: Library,
        state_dir: Path,
        *,
        progress: ProgressStore,
        notepad: NotepadStore,
        chats: ChatStore,
        pages: PageIndex,
        sections: SectionIndex,
        lock: AbstractContextManager[object] | None = None,
    ) -> None:
        self.library = library
        self.state_dir = Path(state_dir).resolve()
        self.progress = progress
        self.notepad = notepad
        self.chats = chats
        self.pages = pages
        self.sections = sections
        self.manifest_path = self.state_dir / "library_manifest.json"
        self.notice_path = self.state_dir / "last_reindex.json"
        self.transaction_path = self.state_dir / "reindex_transaction.json"
        self.moves = _MoveLog(self.state_dir / "relocations.json")
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._manifest: dict[str, FileStamp] | None = None

    # ---- public ---------------------------------------------------------

    def resolve(self, rel: str) -> str:
        """Current location for a path recorded earlier, if it moved."""
        return self.moves.resolve(rel)

    def content_id(self, rel: str) -> str | None:
        """The manifest content hash for a current path, when known."""
        manifest = self._load_manifest()
        if not manifest:
            return None
        stamp = manifest.get(rel)
        if stamp is None or not stamp.present or not stamp.hash:
            return None
        return stamp.hash

    def notice_for(self, report: ReindexReport) -> str:
        """The notice to show now, including a move done by an earlier request."""
        if report.count or report.conflicts or report.failed or report.recovered:
            self._write_notice(report, acknowledged=True)
            return report.notice()
        return self.take_notice()

    def take_notice(self) -> str:
        """Consume a pending move notice written by startup or a redirect."""
        with self._lock:
            try:
                raw: object = json.loads(self.notice_path.read_text(encoding="utf-8"))
            except (FileNotFoundError, OSError, json.JSONDecodeError):
                return ""
            if not isinstance(raw, dict) or raw.get("acknowledged"):
                return ""
            moved = raw.get("moved")
            conflicts = raw.get("conflicts")
            report = ReindexReport(
                moved={
                    str(old_rel): str(new_rel)
                    for old_rel, new_rel in (moved.items() if isinstance(moved, dict) else [])
                    if isinstance(old_rel, str) and isinstance(new_rel, str)
                },
                conflicts=[
                    {str(key): str(value) for key, value in item.items()}
                    for item in (conflicts if isinstance(conflicts, list) else [])
                    if isinstance(item, dict)
                ],
            )
            raw["acknowledged"] = True
            self._write_raw_notice(raw)
            return report.notice()

    def sync(self) -> ReindexReport:
        """Compare the library with the manifest and migrate matched state."""
        with self._lock:
            recovered = self._recover_pending()
            if recovered is False:
                return ReindexReport(failed=["recovery"])
            books = self.library.scan(force=True)
            paths = {book.rel: self.library.root / book.rel for book in books}
            previous = self._load_manifest()
            first_run = not self.manifest_path.exists()
            before = (
                {}
                if previous is None
                else {rel: stamp.to_json() for rel, stamp in previous.items()}
            )

            current: dict[str, FileStamp] = {}
            hashed = 0
            previous_by_signature: dict[tuple[int, int, int, int], str] = {}
            for stamp in (previous or {}).values():
                if stamp.hash:
                    previous_by_signature.setdefault(stamp.signature(), stamp.hash)

            for rel, path in paths.items():
                try:
                    stat = path.stat()
                except OSError:
                    continue
                signature = (
                    stat.st_dev,
                    stat.st_ino,
                    stat.st_size,
                    stat.st_mtime_ns,
                )
                old = (previous or {}).get(rel)
                digest = ""
                if old is not None and old.hash and old.signature() == signature:
                    digest = old.hash
                else:
                    digest = previous_by_signature.get(signature, "")
                    if not digest:
                        digest = _hash_file(path)
                        if digest:
                            hashed += 1
                current[rel] = FileStamp(
                    hash=digest,
                    size=stat.st_size,
                    mtime_ns=stat.st_mtime_ns,
                    dev=stat.st_dev,
                    ino=stat.st_ino,
                )

            report = ReindexReport(hashed=hashed, recovered=bool(recovered))
            if first_run or previous is None:
                # No history to compare with: record the baseline only.
                if not self._save_manifest(current):
                    report.failed = ["manifest"]
                report.added = len(current)
                return report

            vanished = {rel for rel in previous if rel not in current}
            appeared = {rel for rel in current if rel not in previous}
            report.added = len(appeared)
            report.missing = len(vanished)

            pairs = _match_by_content(previous, current)
            if pairs:
                report.moved = pairs
                try:
                    report.backed_up = self._backup_state()
                except OSError:
                    logger.exception("could not back up state; refusing to migrate")
                    report.failed = ["backup"]
                    return report
                if not self._begin_transaction(report.backed_up, pairs):
                    report.failed = ["transaction"]
                    return report
                conflicts: list[dict[str, str]] = []
                failed: list[str] = []
                try:
                    self.notepad.remap(pairs)
                except Exception:
                    failed.append("notes")
                    logger.exception("could not durably remap notes during reindex")
                try:
                    self.chats.remap(pairs)
                except Exception:
                    failed.append("chats")
                    logger.exception("could not durably remap chats during reindex")
                for store, remap in (
                    ("progress", self.progress.remap),
                    ("pages", self.pages.remap),
                    ("sections", self.sections.remap),
                ):
                    try:
                        old_paths = remap(pairs)
                    except Exception:
                        failed.append(store)
                        logger.exception("could not durably remap %s during reindex", store)
                        continue
                    for old_rel in sorted(old_paths):
                        conflicts.append({"store": store, "from": old_rel, "to": pairs[old_rel]})
                report.conflicts = conflicts
                if failed:
                    report.failed = failed
                    self._roll_back(report)
                    return report

                for old_rel in pairs:
                    old_stamp = previous.get(old_rel)
                    if old_stamp is not None:
                        old_stamp.retired = True
                merged = dict(previous)
                for rel, stamp in current.items():
                    merged[rel] = stamp
                for rel, stamp in merged.items():
                    if rel not in current:
                        stamp.present = False
                if _manifest_changed(before, merged) and not self._save_manifest(merged):
                    report.failed = ["manifest"]
                    self._roll_back(report)
                    return report
                if not self.moves.record(pairs):
                    report.failed = ["redirects"]
                    self._roll_back(report)
                    return report
                self._write_notice(report, acknowledged=False)
                self._clear_transaction()
                logger.info("library reindex matched %d moved book(s)", len(pairs))
                return report

            merged = dict(previous)
            for rel, stamp in current.items():
                merged[rel] = stamp
            for rel, stamp in merged.items():
                if rel not in current:
                    stamp.present = False
            if _manifest_changed(before, merged) and not self._save_manifest(merged):
                report.failed = ["manifest"]
            return report

    # ---- transaction ----------------------------------------------------

    def _begin_transaction(self, backup: str | None, pairs: dict[str, str]) -> bool:
        if backup is None:
            return False
        payload = {
            "version": 1,
            "created": datetime.now().timestamp(),
            "backup": backup,
            "moved": pairs,
        }
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.transaction_path.with_name(self.transaction_path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            os.replace(tmp, self.transaction_path)
        except OSError as exc:
            logger.warning("cannot start reindex transaction: %s", exc)
            return False
        return True

    def _clear_transaction(self) -> None:
        try:
            self.transaction_path.unlink()
        except FileNotFoundError:
            return
        except OSError as exc:
            logger.warning("cannot clear reindex transaction: %s", exc)

    def _recover_pending(self) -> bool | None:
        """Roll back a migration interrupted before its commit marker cleared."""
        if not self.transaction_path.exists():
            return None
        try:
            raw: object = json.loads(self.transaction_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("cannot read pending reindex transaction: %s", exc)
            return False
        backup = raw.get("backup") if isinstance(raw, dict) else None
        if not isinstance(backup, str):
            logger.error("pending reindex transaction has no backup path")
            return False
        resolved = Path(backup).resolve()
        backups = (self.state_dir / "backups").resolve()
        if not resolved.is_relative_to(backups) or not resolved.is_dir():
            logger.error("pending reindex backup is outside the state backups: %s", backup)
            return False
        try:
            self._restore_state(str(resolved))
        except OSError:
            logger.exception("cannot recover interrupted reindex from %s", resolved)
            return False
        self._clear_transaction()
        logger.warning("rolled back an interrupted reindex from %s", resolved)
        return True

    # ---- notice ---------------------------------------------------------

    def _write_notice(self, report: ReindexReport, *, acknowledged: bool) -> None:
        self._write_raw_notice(
            {
                "version": 1,
                "updated": datetime.now().timestamp(),
                "moved": report.moved,
                "conflicts": report.conflicts,
                "acknowledged": acknowledged,
            }
        )

    def _write_raw_notice(self, payload: dict[str, object]) -> None:
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.notice_path.with_name(self.notice_path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            os.replace(tmp, self.notice_path)
        except OSError as exc:
            logger.warning("cannot persist reindex notice %s: %s", self.notice_path, exc)

    # ---- manifest -------------------------------------------------------

    def _load_manifest(self) -> dict[str, FileStamp] | None:
        with self._lock:
            if self._manifest is not None:
                return self._manifest
            try:
                raw: object = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return None
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("ignoring unreadable manifest %s: %s", self.manifest_path, exc)
                return None
            books = raw.get("books") if isinstance(raw, dict) else None
            if not isinstance(books, dict):
                return None
            parsed: dict[str, FileStamp] = {}
            for rel, value in books.items():
                stamp = FileStamp.from_json(value)
                if stamp is not None:
                    parsed[str(rel)] = stamp
            self._manifest = parsed
            return self._manifest

    def _save_manifest(self, books: dict[str, FileStamp]) -> bool:
        payload = {
            "version": MANIFEST_VERSION,
            "books": {rel: stamp.to_json() for rel, stamp in sorted(books.items())},
        }
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.manifest_path.with_name(self.manifest_path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.manifest_path)
        except OSError as exc:
            logger.warning("cannot persist library manifest %s: %s", self.manifest_path, exc)
            return False
        self._manifest = books
        return True

    # ---- backup ---------------------------------------------------------

    def _backup_state(self) -> str | None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = self.state_dir / "backups" / f"reindex-{stamp}"
        counter = 1
        while target.exists():
            counter += 1
            target = self.state_dir / "backups" / f"reindex-{stamp}-{counter}"
        target.mkdir(parents=True, exist_ok=True)
        for name in STATE_FILES:
            source = self.state_dir / name
            if source.is_file():
                shutil.copy2(source, target / name)
        return str(target)

    def _roll_back(self, report: ReindexReport) -> None:
        """Restore every store and the manifest, then make caches re-read."""
        if not report.backed_up:
            logger.error("reindex has no backup to roll back to")
            return
        try:
            self._restore_state(report.backed_up)
        except OSError:
            report.failed.append("rollback")
            logger.exception(
                "reindex could not roll back; the pre-move backup is at %s",
                report.backed_up,
            )
        else:
            self._clear_transaction()
            logger.warning(
                "reindex rolled back after %s did not persist; sources stay retryable",
                ", ".join(report.failed),
            )

    def _restore_state(self, backup: str) -> None:
        """Roll every store back to the snapshot for an all-or-nothing retry."""
        source_dir = Path(backup)
        for name in STATE_FILES:
            saved = source_dir / name
            current = self.state_dir / name
            if saved.is_file():
                shutil.copy2(saved, current)
            elif current.exists():
                current.unlink()
        self.progress.reload()
        self.pages.reload()
        self.sections.reload()
        self.notepad.reload()
        self.chats.reload()
        self.moves.reload()
        self._manifest = None


def _manifest_changed(before: dict[str, dict[str, object]], current: dict[str, FileStamp]) -> bool:
    if before.keys() != current.keys():
        return True
    return any(before[rel] != current[rel].to_json() for rel in current)


def _hash_file(path: Path) -> str:
    """SHA-256 of the whole file; the name and timestamps never enter it."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(HASH_CHUNK):
                digest.update(chunk)
    except OSError as exc:
        logger.warning("cannot hash %s: %s", path, exc)
        return ""
    return digest.hexdigest()


def _match_by_content(
    previous: dict[str, FileStamp],
    current: dict[str, FileStamp],
) -> dict[str, str]:
    """One-to-one matches keyed only by content hash.

    Paths whose content is unchanged are neither sources nor destinations;
    their state is already correct. Everything else is matched, which also
    handles a swap: A holding B's old content and B holding A's, with both
    paths still present.
    """
    sources: dict[str, FileStamp] = {}
    for rel, stamp in previous.items():
        if stamp.retired or not stamp.hash:
            continue
        now = current.get(rel)
        if now is not None and now.hash == stamp.hash:
            continue
        sources[rel] = stamp

    destinations: dict[str, FileStamp] = {}
    for rel, stamp in current.items():
        if stamp.hash:
            # An unchanged path is still a valid destination when the source
            # disappeared: a copy made earlier may now be the only survivor.
            destinations[rel] = stamp

    sources_by_hash: dict[str, list[str]] = {}
    destinations_by_hash: dict[str, list[str]] = {}
    for rel, stamp in sources.items():
        sources_by_hash.setdefault(stamp.hash, []).append(rel)
    for rel, stamp in destinations.items():
        destinations_by_hash.setdefault(stamp.hash, []).append(rel)

    pairs: dict[str, str] = {}
    for digest, olds in sources_by_hash.items():
        news = destinations_by_hash.get(digest, [])
        if len(olds) == 1 and len(news) == 1:
            pairs[olds[0]] = news[0]
    return pairs
