"""File stamps, content hashing and one-to-one move matching."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

MANIFEST_VERSION = 1
HASH_CHUNK = 1024 * 1024


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


def manifest_changed(before: dict[str, dict[str, object]], current: dict[str, FileStamp]) -> bool:
    if before.keys() != current.keys():
        return True
    return any(before[rel] != current[rel].to_json() for rel in current)


def hash_file(path: Path) -> str:
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


def match_by_content(
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
