"""Match library books to items in a local Zotero database and expose their metadata.

The Zotero data directory is only ever read: ``zotero.sqlite`` is opened read-only and
immutable (so a running Zotero keeps its lock), and attachment files are only stat'ed or
hashed. Nothing is written to Zotero and nothing leaves the machine.
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

from ..library.models import Book

logger = logging.getLogger(__name__)

DATABASE_NAME = "zotero.sqlite"
STORAGE_DIR = "storage"
# linkMode values from Zotero's schema: 0/1 are stored copies, 2 is a linked file.
LINKED_FILE = 2
# Titles shorter than this are too generic ("Notes", "Thesis") to match on alone.
MIN_TITLE_KEY = 12

_ARXIV = re.compile(r"(?<!\d)(\d{4}\.\d{4,5})(?:v\d+)?(?!\d)")
_DOI = re.compile(r"10\.\d{4,9}/[^\s\"<>]+", re.IGNORECASE)
_YEAR = re.compile(r"\b(\d{4})\b")
_NON_WORD = re.compile(r"[^a-z0-9]+")

_FIELDS = ("title", "date", "DOI", "url", "extra", "archiveID", "publicationTitle")


@dataclass(slots=True)
class _Attachment:
    filename: str
    path: Path | None
    storage_hash: str


@dataclass(slots=True)
class _Item:
    key: str
    item_type: str
    fields: dict[str, str] = field(default_factory=dict)
    creators: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    collections: list[str] = field(default_factory=list)
    attachments: list[_Attachment] = field(default_factory=list)

    def identifiers(self) -> str:
        return " ".join(self.fields.get(name, "") for name in ("DOI", "url", "extra", "archiveID"))

    def as_dict(self, matched_by: str) -> dict[str, object]:
        year = _YEAR.search(self.fields.get("date", ""))
        return {
            "key": self.key,
            "title": self.fields.get("title", ""),
            "creators": self.creators,
            "year": year.group(1) if year else "",
            "item_type": self.item_type,
            "publication": self.fields.get("publicationTitle", ""),
            "doi": self.fields.get("DOI", ""),
            "url": self.fields.get("url", ""),
            "tags": self.tags,
            "collections": self.collections,
            "matched_by": matched_by,
            "select_uri": f"zotero://select/library/items/{self.key}",
        }


def _title_key(text: str) -> str:
    return _NON_WORD.sub(" ", text.casefold()).strip()


def _md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ZoteroLibrary:
    """Read-only view of one Zotero data directory, matched against the book library."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir).expanduser()
        self.database = self.data_dir / DATABASE_NAME
        self._lock = threading.Lock()
        self._cache_key: tuple[object, ...] | None = None
        self._cache: dict[str, object] = {}

    @property
    def available(self) -> bool:
        return self.database.is_file()

    def snapshot(self, books: Iterable[Book], root: Path) -> dict[str, object]:
        """Zotero metadata for every book that matches an item, keyed by ``rel``."""
        book_list = list(books)
        if not self.available:
            return _unavailable("No zotero.sqlite in the configured Zotero directory.")
        try:
            stamp = self.database.stat()
        except OSError as exc:
            return _unavailable(f"The Zotero database could not be read: {exc}")
        key = (
            stamp.st_mtime_ns,
            stamp.st_size,
            tuple((book.rel, book.size, book.mtime) for book in book_list),
        )
        with self._lock:
            if key == self._cache_key:
                return self._cache
            try:
                items = self._load_items()
            except sqlite3.Error as exc:
                logger.warning("zotero database unreadable: %s", exc)
                return _unavailable(f"The Zotero database could not be read: {exc}")
            matched = _match(book_list, Path(root), items)
            collections = sorted(
                {name for meta in matched.values() for name in _strings(meta["collections"])},
                key=str.casefold,
            )
            result: dict[str, object] = {
                "available": True,
                "reason": "",
                "item_count": len(items),
                "matched": len(matched),
                "books": matched,
                "collections": collections,
            }
            self._cache_key = key
            self._cache = result
            return result

    def _connect(self) -> sqlite3.Connection:
        uri = f"file:{quote(str(self.database))}?mode=ro&immutable=1"
        return sqlite3.connect(uri, uri=True)

    def _load_items(self) -> list[_Item]:
        connection = self._connect()
        try:
            return self._read(connection)
        finally:
            connection.close()

    def _read(self, db: sqlite3.Connection) -> list[_Item]:
        items: dict[int, _Item] = {}
        for item_id, key, type_name in db.execute(
            "SELECT i.itemID, i.key, t.typeName FROM items i"
            " JOIN itemTypes t ON t.itemTypeID = i.itemTypeID"
            " WHERE t.typeName NOT IN ('note', 'annotation')"
            " AND i.itemID NOT IN (SELECT itemID FROM deletedItems)"
        ):
            items[int(item_id)] = _Item(key=str(key), item_type=str(type_name))

        marks = ",".join("?" for _ in _FIELDS)
        for item_id, name, value in db.execute(
            "SELECT d.itemID, f.fieldName, v.value FROM itemData d"
            " JOIN fields f ON f.fieldID = d.fieldID"
            " JOIN itemDataValues v ON v.valueID = d.valueID"
            f" WHERE f.fieldName IN ({marks})",
            _FIELDS,
        ):
            item = items.get(int(item_id))
            if item is not None:
                item.fields[str(name)] = str(value)

        for item_id, first, last in db.execute(
            "SELECT ic.itemID, c.firstName, c.lastName FROM itemCreators ic"
            " JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex"
        ):
            item = items.get(int(item_id))
            name = " ".join(part for part in (first, last) if part)
            if item is not None and name:
                item.creators.append(name)

        for item_id, tag in db.execute(
            "SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID"
            " ORDER BY t.name"
        ):
            item = items.get(int(item_id))
            if item is not None:
                item.tags.append(str(tag))

        for item_id, collection in db.execute(
            "SELECT ci.itemID, c.collectionName FROM collectionItems ci"
            " JOIN collections c ON c.collectionID = ci.collectionID ORDER BY c.collectionName"
        ):
            item = items.get(int(item_id))
            if item is not None:
                item.collections.append(str(collection))

        for item_id, parent_id, path, link_mode, storage_hash in db.execute(
            "SELECT itemID, parentItemID, path, linkMode, storageHash FROM itemAttachments"
            " WHERE path IS NOT NULL"
        ):
            own = items.get(int(item_id))
            if own is None:
                continue
            # A child attachment describes its parent; a standalone one describes itself.
            target = items.get(int(parent_id)) if parent_id is not None else own
            if target is None:
                continue
            raw = str(path)
            if int(link_mode) == LINKED_FILE:
                location: Path | None = Path(raw)
                filename = Path(raw).name
            else:
                filename = raw.removeprefix("storage:")
                location = self.data_dir / STORAGE_DIR / own.key / filename
            target.attachments.append(
                _Attachment(filename=filename, path=location, storage_hash=str(storage_hash or ""))
            )

        return [
            item for item in items.values() if item.item_type != "attachment" or item.attachments
        ]


def _unavailable(reason: str) -> dict[str, object]:
    return {
        "available": False,
        "reason": reason,
        "item_count": 0,
        "matched": 0,
        "books": {},
        "collections": [],
    }


def _strings(value: object) -> list[str]:
    return [str(entry) for entry in value] if isinstance(value, list) else []


def _attachment_size(attachment: _Attachment) -> int | None:
    if attachment.path is None:
        return None
    try:
        return attachment.path.stat().st_size
    except OSError:
        return None


def _match(books: list[Book], root: Path, items: list[_Item]) -> dict[str, dict[str, object]]:
    """Most certain evidence first: same bytes, same filename, same identifier, same title."""
    by_size: dict[int, list[tuple[_Item, _Attachment]]] = {}
    by_name: dict[str, _Item] = {}
    by_title: dict[str, _Item] = {}
    by_identifier: list[tuple[str, _Item]] = []
    for item in items:
        for attachment in item.attachments:
            by_name.setdefault(attachment.filename.casefold(), item)
            size = _attachment_size(attachment)
            if size:
                by_size.setdefault(size, []).append((item, attachment))
        title = _title_key(item.fields.get("title", ""))
        if len(title) >= MIN_TITLE_KEY:
            by_title.setdefault(title, item)
        identifiers = item.identifiers().casefold()
        if identifiers.strip():
            by_identifier.append((identifiers, item))

    matched: dict[str, dict[str, object]] = {}
    for book in books:
        found = _match_book(book, root, by_size, by_name, by_identifier, by_title)
        if found is not None:
            item, how = found
            matched[book.rel] = item.as_dict(how)
    return matched


def _match_book(
    book: Book,
    root: Path,
    by_size: dict[int, list[tuple[_Item, _Attachment]]],
    by_name: dict[str, _Item],
    by_identifier: list[tuple[str, _Item]],
    by_title: dict[str, _Item],
) -> tuple[_Item, str] | None:
    # Only files whose size equals a Zotero attachment's are hashed, so this stays cheap.
    candidates = by_size.get(book.size, [])
    if candidates:
        try:
            digest = _md5(root / book.rel)
        except OSError:
            digest = ""
        for item, attachment in candidates:
            other = attachment.storage_hash
            if not other and attachment.path is not None:
                try:
                    other = _md5(attachment.path)
                except OSError:
                    other = ""
            if digest and digest == other:
                return item, "content"

    name = Path(book.rel).name
    by_filename = by_name.get(name.casefold())
    if by_filename is not None:
        return by_filename, "filename"

    needles = [m.group(1) for m in _ARXIV.finditer(name)]
    needles += [m.group(0).rstrip(".").casefold() for m in _DOI.finditer(name)]
    for needle in needles:
        for identifiers, item in by_identifier:
            if needle in identifiers:
                return item, "identifier"

    title = _title_key(book.title)
    if len(title) >= MIN_TITLE_KEY and title in by_title:
        return by_title[title], "title"
    return None
