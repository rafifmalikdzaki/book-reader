"""Researcher notepad: groups of notes anchored to document locations.

Notes are grouped by idea, not by document, and carry a locator that survives
re-reading: PDF notes store a page plus character offsets inside that page's
text layer; Markdown notes store line numbers, character offsets, and the
enclosing section. Both forms export as AI context.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path
from typing import TypedDict

from .statemove import RemapError

logger = logging.getLogger(__name__)

MAX_QUOTE = 8000
MAX_COMMENT = 8000
MAX_GROUP_NAME = 120
MAX_NOTES_PER_GROUP = 2000
INBOX_ID = "inbox"
INBOX_NAME = "Inbox"

Group = dict[str, object]
Note = dict[str, object]


class _State(TypedDict):
    groups: list[Group]
    notes: list[Note]


class NotepadError(ValueError):
    """Invalid notepad operation (unknown group, empty quote, ...)."""


class NotepadStore:
    """JSON-backed notepad.

    Schema on disk::

        {"version": 1,
         "groups": [{"id": "inbox", "name": "Inbox", "created": 1762500000.0}],
         "notes": [{"id": "...", "group": "inbox", "book": "book.pdf", "kind": "pdf",
                    "quote": "...", "page": 12, "section": "", "char_start": 100,
                    "char_end": 140, "comment": "", "created": ..., "updated": ...}]}
    """

    def __init__(
        self, state_dir: Path, *, lock: AbstractContextManager[object] | None = None
    ) -> None:
        self.state_dir = Path(state_dir)
        self.path = self.state_dir / "notepad.json"
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._data: _State | None = None

    def _load(self) -> _State:
        with self._lock:
            if self._data is None:
                self._data = self._read()
            return self._data

    def _read(self) -> _State:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"groups": [], "notes": []}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable notepad %s: %s", self.path, exc)
            return {"groups": [], "notes": []}
        if not isinstance(raw, dict):
            return {"groups": [], "notes": []}
        groups = raw.get("groups")
        notes = raw.get("notes")
        return {
            "groups": [dict(group) for group in groups if isinstance(group, dict)]
            if isinstance(groups, list)
            else [],
            "notes": [dict(note) for note in notes if isinstance(note, dict)]
            if isinstance(notes, list)
            else [],
        }

    def remap(self, mapping: dict[str, str]) -> int:
        """Point stored notes at moved books; note ids and groups stay put."""
        if not mapping:
            return 0
        with self._lock:
            data = self._load()
            original = data["notes"]
            updated: list[Note] = []
            changed = 0
            for note in original:
                copy = dict(note)
                book = copy.get("book")
                if isinstance(book, str) and book in mapping:
                    copy["book"] = mapping[book]
                    changed += 1
                updated.append(copy)
            if changed:
                data["notes"] = updated
                if not self._write():
                    data["notes"] = original
                    raise RemapError(f"cannot persist notes to {self.path}")
        return changed

    def _write(self) -> bool:
        data = self._load()
        payload = {"version": 1, "groups": data["groups"], "notes": data["notes"]}
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist notepad to %s: %s", self.path, exc)
            return False
        return True

    def _groups(self) -> list[Group]:
        return self._load()["groups"]

    def _notes(self) -> list[Note]:
        return self._load()["notes"]

    def _ensure_inbox(self) -> Group:
        inbox = next((group for group in self._groups() if group.get("id") == INBOX_ID), None)
        if inbox is None:
            inbox = {"id": INBOX_ID, "name": INBOX_NAME, "created": time.time()}
            self._groups().insert(0, inbox)
        return inbox

    def reload(self) -> None:
        with self._lock:
            self._data = None

    def groups(self) -> list[Group]:
        with self._lock:
            self._ensure_inbox()
            return [dict(group) for group in self._groups()]

    def create_group(self, name: str) -> Group:
        clean = " ".join(name.split())
        if not clean:
            raise NotepadError("group name must not be empty")
        if len(clean) > MAX_GROUP_NAME:
            raise NotepadError(f"group name must be at most {MAX_GROUP_NAME} characters")
        with self._lock:
            if any(
                str(group.get("name")).casefold() == clean.casefold() for group in self._groups()
            ):
                raise NotepadError(f"group already exists: {clean}")
            group: Group = {"id": secrets.token_hex(6), "name": clean, "created": time.time()}
            self._groups().append(group)
            self._write()
            return dict(group)

    def delete_group(self, group_id: str) -> int:
        """Remove a group and its notes; returns the number of notes removed."""
        with self._lock:
            if group_id == INBOX_ID:
                raise NotepadError("the inbox group cannot be deleted")
            groups = self._groups()
            if not any(group.get("id") == group_id for group in groups):
                raise NotepadError(f"unknown group: {group_id}")
            removed = [note for note in self._notes() if note.get("group") == group_id]
            self._load()["groups"] = [group for group in groups if group.get("id") != group_id]
            self._load()["notes"] = [
                note for note in self._notes() if note.get("group") != group_id
            ]
            self._write()
            return len(removed)

    def notes(self, *, group: str | None = None, book: str | None = None) -> list[Note]:
        with self._lock:
            selected = [
                dict(note)
                for note in self._notes()
                if (group is None or note.get("group") == group)
                and (book is None or note.get("book") == book)
            ]
        selected.sort(key=lambda note: float(str(note.get("created") or 0.0)))
        return selected

    def add_note(
        self,
        *,
        group: str,
        book: str,
        kind: str,
        quote: str,
        page: int | None = None,
        section: str = "",
        char_start: int | None = None,
        char_end: int | None = None,
        line_start: int | None = None,
        line_end: int | None = None,
        paragraph: int | None = None,
        comment: str = "",
    ) -> Note:
        text = quote.strip()
        if not text:
            raise NotepadError("quote must not be empty")
        if len(text) > MAX_QUOTE:
            raise NotepadError(f"quote must be at most {MAX_QUOTE} characters")
        if len(comment) > MAX_COMMENT:
            raise NotepadError(f"comment must be at most {MAX_COMMENT} characters")
        if kind not in {"pdf", "md"}:
            raise NotepadError("kind must be 'pdf' or 'md'")
        if kind == "pdf" and page is None:
            raise NotepadError("pdf notes need a page number")
        with self._lock:
            self._ensure_inbox()
            group_id = group or INBOX_ID
            if not any(group_.get("id") == group_id for group_ in self._groups()):
                raise NotepadError(f"unknown group: {group_id}")
            if len([note for note in self._notes() if note.get("group") == group_id]) >= (
                MAX_NOTES_PER_GROUP
            ):
                raise NotepadError(f"group is full ({MAX_NOTES_PER_GROUP} notes)")
            now = time.time()
            note: Note = {
                "id": secrets.token_hex(6),
                "group": group_id,
                "book": book,
                "kind": kind,
                "quote": text,
                "page": page,
                "section": " ".join(section.split())[:MAX_GROUP_NAME],
                "char_start": char_start,
                "char_end": char_end,
                "line_start": line_start,
                "line_end": line_end,
                "paragraph": paragraph,
                "comment": comment.strip(),
                "created": now,
                "updated": now,
            }
            self._notes().append(note)
            self._write()
            return dict(note)

    def update_note(
        self, note_id: str, *, comment: str | None = None, group: str | None = None
    ) -> Note:
        if comment is not None and len(comment) > MAX_COMMENT:
            raise NotepadError(f"comment must be at most {MAX_COMMENT} characters")
        with self._lock:
            if group is not None and not any(
                group_.get("id") == group for group_ in self._groups()
            ):
                raise NotepadError(f"unknown group: {group}")
            note = next((note for note in self._notes() if note.get("id") == note_id), None)
            if note is None:
                raise NotepadError(f"unknown note: {note_id}")
            if comment is not None:
                note["comment"] = comment.strip()
            if group is not None:
                note["group"] = group
            note["updated"] = time.time()
            self._write()
            return dict(note)

    def delete_note(self, note_id: str) -> None:
        with self._lock:
            remaining = [note for note in self._notes() if note.get("id") != note_id]
            if len(remaining) == len(self._notes()):
                raise NotepadError(f"unknown note: {note_id}")
            self._load()["notes"] = remaining
            self._write()

    def export_json(self, group: str | None = None) -> dict[str, object]:
        with self._lock:
            groups = [
                dict(entry) for entry in self.groups() if group is None or entry.get("id") == group
            ]
            notes = self.notes(group=group)
        return {
            "version": 1,
            "exported": time.time(),
            "groups": groups,
            "notes": notes,
        }

    def export_markdown(self, group: str | None = None) -> str:
        groups = {
            str(entry.get("id")): entry
            for entry in self.groups()
            if group is None or entry.get("id") == group
        }
        notes = self.notes(group=group)
        lines = ["# Reading notes", ""]
        if not notes:
            lines.append("_No notes yet._")
            return "\n".join(lines) + "\n"
        current = None
        for note in notes:
            group_id = str(note.get("group") or INBOX_ID)
            if group_id != current:
                current = group_id
                entry = groups.get(group_id) or {"name": group_id}
                lines.extend([f"## {entry.get('name')}", "", "---", ""])
            lines.extend(_note_markdown(note))
        return "\n".join(lines).rstrip() + "\n"


def _note_markdown(note: Note) -> list[str]:
    kind = str(note.get("kind"))
    book = str(note.get("book"))
    section = str(note.get("section") or "")
    page = note.get("page")
    line_start = note.get("line_start")
    line_end = note.get("line_end")

    if kind == "pdf" and page is not None:
        anchor = f"p.{page}"
        source = f"{book}#p{page}"
        if line_start is not None:
            anchor += f" · lines {line_start}"
            if line_end is not None and line_end != line_start:
                anchor += f"-{line_end}"
    elif line_start is not None:
        anchor = f"lines {line_start}" + (f"-{line_end}" if line_end != line_start else "")
        source = f"{book}#L{line_start}"
    else:
        anchor = "unlocated"
        source = book
    if section:
        anchor += f" · §{section}"
    paragraph = note.get("paragraph")
    if paragraph is not None:
        anchor += f" · ¶{paragraph}"

    quote = " ".join(str(note.get("quote") or "").split())
    lines = [
        f"### {book} · {anchor}",
        "",
        f"> {quote}",
        "",
    ]
    comment = str(note.get("comment") or "").strip()
    if comment:
        lines.extend([comment, ""])
    char_start = note.get("char_start")
    char_end = note.get("char_end")
    locator = f"source: `{source}`"
    if char_start is not None and char_end is not None:
        locator += f" · chars {char_start}-{char_end}"
    lines.extend([locator, ""])
    return lines
