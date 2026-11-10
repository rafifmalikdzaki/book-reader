"""Zotero bridge: a tiny database with the tables the reader queries, matched read-only."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.library.scan import Library
from book_reader.zotero.library import ZoteroLibrary

SCHEMA = """
CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, key TEXT);
CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
CREATE TABLE itemCreators (itemID INT, creatorID INT, orderIndex INT);
CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE itemTags (itemID INT, tagID INT);
CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT);
CREATE TABLE collectionItems (collectionID INT, itemID INT);
CREATE TABLE itemAttachments (
  itemID INTEGER PRIMARY KEY, parentItemID INT, path TEXT, linkMode INT, storageHash TEXT
);
INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment'), (3, 'note');
INSERT INTO fields VALUES (1, 'title'), (2, 'date'), (3, 'url'), (4, 'DOI');
"""


class Builder:
    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir
        (data_dir / "storage").mkdir(parents=True)
        self.db = sqlite3.connect(data_dir / "zotero.sqlite")
        self.db.executescript(SCHEMA)
        self.next = 1
        self.values = 0

    def _field(self, item: int, field: int, value: str) -> None:
        self.values += 1
        self.db.execute("INSERT INTO itemDataValues VALUES (?, ?)", (self.values, value))
        self.db.execute("INSERT INTO itemData VALUES (?, ?, ?)", (item, field, self.values))

    def article(self, title: str, *, year: str = "2020", url: str = "") -> int:
        item = self.next
        self.next += 1
        self.db.execute("INSERT INTO items VALUES (?, 1, ?)", (item, f"KEY{item}"))
        self._field(item, 1, title)
        self._field(item, 2, f"{year}-00-00 {year}")
        if url:
            self._field(item, 3, url)
        return item

    def attach(self, parent: int, filename: str, *, content: bytes | None = None) -> None:
        item = self.next
        self.next += 1
        key = f"ATT{item}"
        self.db.execute("INSERT INTO items VALUES (?, 2, ?)", (item, key))
        digest = None
        if content is not None:
            (self.dir / "storage" / key).mkdir()
            (self.dir / "storage" / key / filename).write_bytes(content)
            digest = hashlib.md5(content, usedforsecurity=False).hexdigest()
        self.db.execute(
            "INSERT INTO itemAttachments VALUES (?, ?, ?, 0, ?)",
            (item, parent, f"storage:{filename}", digest),
        )

    def done(self) -> None:
        self.db.commit()
        self.db.close()


def build(tmp_path: Path, library: Path) -> Path:
    data_dir = tmp_path / "zotero"
    b = Builder(data_dir)

    same_bytes = b.article("Attention Is All You Need", year="2017")
    b.attach(same_bytes, "Vaswani 2017.pdf", content=(library / "sub" / "a.pdf").read_bytes())
    b.db.execute("INSERT INTO creators VALUES (1, 'Ashish', 'Vaswani'), (2, 'Noam', 'Shazeer')")
    b.db.execute("INSERT INTO itemCreators VALUES (?, 2, 1), (?, 1, 0)", (same_bytes, same_bytes))
    b.db.execute("INSERT INTO tags VALUES (1, 'transformers'), (2, 'attention')")
    b.db.execute("INSERT INTO itemTags VALUES (?, 1), (?, 2)", (same_bytes, same_bytes))
    b.db.execute("INSERT INTO collections VALUES (1, 'Thesis')")
    b.db.execute("INSERT INTO collectionItems VALUES (1, ?)", (same_bytes,))

    by_arxiv = b.article("Mathematics of Neural Networks", url="https://arxiv.org/abs/2403.04807")
    b.attach(by_arxiv, "other-name.pdf")

    deleted = b.article("Deleted Paper With A Long Title")
    b.attach(deleted, "note.md")
    b.db.execute("INSERT INTO deletedItems VALUES (?)", (deleted,))

    b.done()
    return data_dir


def test_books_are_matched_by_content_then_identifier(tmp_path: Path, library: Path) -> None:
    (library / "2403.04807v1.pdf").write_bytes(b"%PDF-1.4 different bytes")
    data_dir = build(tmp_path, library)
    before = (data_dir / "zotero.sqlite").read_bytes()

    lib = Library(library)
    snapshot = ZoteroLibrary(data_dir).snapshot(lib.scan(), lib.root)

    assert snapshot["available"] is True
    books = snapshot["books"]
    assert isinstance(books, dict)
    paper = books["sub/a.pdf"]
    assert paper["matched_by"] == "content"
    assert paper["title"] == "Attention Is All You Need"
    assert paper["creators"] == ["Ashish Vaswani", "Noam Shazeer"]
    assert paper["year"] == "2017"
    assert paper["tags"] == ["attention", "transformers"]
    assert paper["collections"] == ["Thesis"]
    assert paper["select_uri"] == "zotero://select/library/items/KEY1"
    assert books["2403.04807v1.pdf"]["matched_by"] == "identifier"
    # The deleted item's attachment shares note.md's filename but must not match.
    assert "note.md" not in books
    assert snapshot["collections"] == ["Thesis"]
    assert snapshot["matched"] == 2
    # Read-only: the database is byte-identical and no journal appeared beside it.
    assert (data_dir / "zotero.sqlite").read_bytes() == before
    assert sorted(p.name for p in data_dir.iterdir()) == ["storage", "zotero.sqlite"]


def test_missing_or_broken_database_reports_unavailable(tmp_path: Path, library: Path) -> None:
    lib = Library(library)
    assert ZoteroLibrary(tmp_path / "nowhere").snapshot(lib.scan(), lib.root)["available"] is False
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "zotero.sqlite").write_bytes(b"not a database")
    snapshot = ZoteroLibrary(broken).snapshot(lib.scan(), lib.root)
    assert snapshot["available"] is False and snapshot["books"] == {}


def test_endpoint_is_off_by_default_and_on_with_a_directory(
    tmp_path: Path, library: Path, spa_static: Path, client: tuple[TestClient, Path]
) -> None:
    test_client, _state = client
    off = test_client.get("/api/zotero").json()
    assert off["available"] is False and off["books"] == {}

    data_dir = build(tmp_path, library)
    app = create_app(library, tmp_path / "state2", static_dir=spa_static, zotero_dir=data_dir)
    with TestClient(app) as on:
        body = on.get("/api/zotero").json()
    assert body["available"] is True
    assert body["books"]["sub/a.pdf"]["key"] == "KEY1"


def test_titles_match_only_when_long_enough_to_be_specific(tmp_path: Path, library: Path) -> None:
    (library / "Deep Learning Foundations.pdf").write_bytes(b"%PDF-1.4 a")
    (library / "Thesis.pdf").write_bytes(b"%PDF-1.4 bb")
    b = Builder(tmp_path / "zotero")
    b.article("Deep Learning Foundations")
    b.article("Thesis")
    b.done()

    lib = Library(library)
    books = ZoteroLibrary(tmp_path / "zotero").snapshot(lib.scan(), lib.root)["books"]
    assert isinstance(books, dict)
    assert books["Deep Learning Foundations.pdf"]["matched_by"] == "title"
    assert "Thesis.pdf" not in books
