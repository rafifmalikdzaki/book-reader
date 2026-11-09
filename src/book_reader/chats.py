"""Persistent Ask sessions: seven-day transcripts, pins, and chat projects.

Sessions are grouped by activity, not by book. The retention clock is the last
change to a session (a message, a pin, or a project assignment). A session that
is pinned or assigned to a project never expires.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import secrets
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path
from typing import TypedDict, cast

logger = logging.getLogger(__name__)

RETENTION_DAYS = 7
MAX_MESSAGES = 400
MAX_TITLE = 80
MAX_PROJECT_NAME = 60
MAX_MESSAGE_CHARS = 8000


class ChatError(ValueError):
    """Invalid chat state operation (unknown session, bad project name, ...)."""


class ChatStorageError(RuntimeError):
    """The chat state could not be written."""


class StoredMessage(TypedDict):
    id: str
    role: str
    content: str
    sources: list[dict[str, object]]
    provider: str
    model: str
    created: float


class ChatSession(TypedDict, total=False):
    id: str
    title: str
    created: float
    updated: float
    pinned: bool
    project_id: str | None
    book: str | None
    page: int | None
    categories: list[str]
    messages: list[StoredMessage]
    status: str
    thought_step: str
    last_error: str | None


class ChatProject(TypedDict):
    id: str
    name: str
    created: float


class _State(TypedDict):
    projects: list[ChatProject]
    sessions: list[ChatSession]


class _Unset:
    pass


_UNSET = _Unset()


def _timestamp(value: object) -> float:
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return 0.0


def _text(value: object, *, limit: int | None = None) -> str:
    text = str(value or "")
    return text[:limit] if limit is not None else text


def _message(raw: object) -> StoredMessage | None:
    if not isinstance(raw, dict):
        return None
    role = _text(raw.get("role")).strip()
    content = _text(raw.get("content"))
    if role not in {"user", "assistant"} or not content:
        return None
    sources_raw = raw.get("sources")
    sources = (
        [dict(source) for source in sources_raw if isinstance(source, dict)]
        if isinstance(sources_raw, list)
        else []
    )
    return {
        "id": _text(raw.get("id")) or secrets.token_hex(8),
        "role": role,
        "content": content[:MAX_MESSAGE_CHARS],
        "sources": sources,
        "provider": _text(raw.get("provider")),
        "model": _text(raw.get("model")),
        "created": _timestamp(raw.get("created")),
    }


def _project(raw: object) -> ChatProject | None:
    if not isinstance(raw, dict):
        return None
    project_id = _text(raw.get("id")).strip()
    name = " ".join(_text(raw.get("name")).split())
    if not project_id or not name:
        return None
    return {
        "id": project_id,
        "name": name[:MAX_PROJECT_NAME],
        "created": _timestamp(raw.get("created")),
    }


def _session(raw: object) -> ChatSession | None:
    if not isinstance(raw, dict):
        return None
    session_id = _text(raw.get("id")).strip()
    if not session_id:
        return None
    messages_raw = raw.get("messages")
    messages = (
        [message for item in messages_raw if (message := _message(item)) is not None]
        if isinstance(messages_raw, list)
        else []
    )
    page = raw.get("page")
    try:
        page_number = int(str(page)) if page is not None else None
    except (TypeError, ValueError):
        page_number = None
    project_id = raw.get("project_id")
    book = raw.get("book")
    categories_raw = raw.get("categories")
    categories: list[str] = []
    if isinstance(categories_raw, list):
        for item in categories_raw:
            category = _text(item).strip()
            if category and category not in categories:
                categories.append(category)
    status = _text(raw.get("status")) or "idle"
    if status == "thinking":
        status = "idle"
    return {
        "id": session_id,
        "title": " ".join(_text(raw.get("title"), limit=MAX_TITLE).split()) or "New chat",
        "created": _timestamp(raw.get("created")),
        "updated": _timestamp(raw.get("updated")),
        "pinned": bool(raw.get("pinned")),
        "project_id": _text(project_id) if project_id is not None else None,
        "book": _text(book) if book is not None else None,
        "page": page_number if page_number and page_number > 0 else None,
        "categories": categories,
        "messages": messages,
        "status": status,
        "thought_step": _text(raw.get("thought_step")),
        "last_error": _text(raw.get("last_error")) if raw.get("last_error") is not None else None,
    }


def _copy_session(session: ChatSession) -> ChatSession:
    return copy.deepcopy(session)


class ChatStore:
    """JSON-backed chat sessions and projects under one state directory."""

    def __init__(
        self,
        state_dir: Path,
        *,
        lock: AbstractContextManager[object] | None = None,
        retention_days: int = RETENTION_DAYS,
    ) -> None:
        self.state_dir = Path(state_dir)
        self.path = self.state_dir / "chats.json"
        self.retention_days = retention_days
        self._lock: AbstractContextManager[object] = lock or threading.RLock()
        self._data: _State | None = None

    def _load(self) -> _State:
        with self._lock:
            if self._data is None:
                self._data = self._read()
            if self._prune(self._data, time.time()):
                self._write(self._data)
            return self._data

    def _read(self) -> _State:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"projects": [], "sessions": []}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable chat state %s: %s", self.path, exc)
            return {"projects": [], "sessions": []}
        if not isinstance(raw, dict):
            return {"projects": [], "sessions": []}
        projects_raw = raw.get("projects")
        sessions_raw = raw.get("sessions")
        projects = (
            [project for item in projects_raw if (project := _project(item)) is not None]
            if isinstance(projects_raw, list)
            else []
        )
        sessions = (
            [session for item in sessions_raw if (session := _session(item)) is not None]
            if isinstance(sessions_raw, list)
            else []
        )
        project_ids = {project["id"] for project in projects}
        for session in sessions:
            if session["project_id"] is not None and session["project_id"] not in project_ids:
                session["project_id"] = None
        return {"projects": projects, "sessions": sessions}

    def _write(self, data: _State) -> bool:
        payload = {"version": 1, "projects": data["projects"], "sessions": data["sessions"]}
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("cannot persist chat state to %s: %s", self.path, exc)
            return False
        return True

    def _persist(self, data: _State) -> None:
        if not self._write(data):
            raise ChatStorageError(f"cannot persist chat state to {self.path}")

    def _prune(self, data: _State, now: float) -> int:
        cutoff = now - self.retention_days * 86400
        before = len(data["sessions"])
        data["sessions"] = [
            session
            for session in data["sessions"]
            if session["pinned"]
            or session["project_id"] is not None
            or session["updated"] >= cutoff
        ]
        return before - len(data["sessions"])

    def reload(self) -> None:
        with self._lock:
            self._data = None

    def remap(self, mapping: dict[str, str]) -> int:
        """Follow renames in session book context and stored source links."""
        if not mapping:
            return 0
        with self._lock:
            data = self._load()
            changed = 0
            for session in data["sessions"]:
                book = session["book"]
                if book is not None and book in mapping:
                    session["book"] = mapping[book]
                    changed += 1
                for message in session["messages"]:
                    for source in message["sources"]:
                        source_book = source.get("book")
                        if isinstance(source_book, str) and source_book in mapping:
                            source["book"] = mapping[source_book]
                            changed += 1
            if changed:
                self._persist(data)
            return changed

    def remove_expired(self, *, now: float | None = None) -> int:
        with self._lock:
            data = self._load()
            removed = self._prune(data, now if now is not None else time.time())
            if removed:
                self._persist(data)
            return removed

    def _find_session(self, session_id: str) -> ChatSession | None:
        return next(
            (session for session in self._load()["sessions"] if session["id"] == session_id),
            None,
        )

    def _find_project(self, project_id: str) -> ChatProject | None:
        return next(
            (project for project in self._load()["projects"] if project["id"] == project_id),
            None,
        )

    def create_session(
        self,
        book: str | None = None,
        page: int | None = None,
        categories: list[str] | None = None,
    ) -> ChatSession:
        with self._lock:
            data = self._load()
            now = time.time()
            session: ChatSession = {
                "id": secrets.token_hex(8),
                "title": "New chat",
                "created": now,
                "updated": now,
                "pinned": False,
                "project_id": None,
                "book": book,
                "page": page,
                "categories": list(dict.fromkeys(categories or [])),
                "messages": [],
                "status": "idle",
                "thought_step": "",
                "last_error": None,
            }
            data["sessions"].append(session)
            self._persist(data)
            return _copy_session(session)

    def list_sessions(self) -> list[dict[str, object]]:
        with self._lock:
            sessions = sorted(
                self._load()["sessions"], key=lambda session: session["updated"], reverse=True
            )
            result: list[dict[str, object]] = []
            for session in sessions:
                last = session["messages"][-1]["content"] if session["messages"] else ""
                result.append(
                    {
                        "id": session["id"],
                        "title": session["title"],
                        "created": session["created"],
                        "updated": session["updated"],
                        "pinned": session["pinned"],
                        "project_id": session["project_id"],
                        "book": session["book"],
                        "page": session["page"],
                        "categories": list(session["categories"]),
                        "message_count": len(session["messages"]),
                        "preview": " ".join(last.split())[:120],
                        "status": session.get("status", "idle"),
                        "thought_step": session.get("thought_step", ""),
                    }
                )
            return result

    def set_session_status(
        self,
        session_id: str,
        status: str,
        *,
        thought_step: str = "",
        last_error: str | None = None,
    ) -> ChatSession:
        with self._lock:
            data = self._load()
            session = self._find_session(session_id)
            if session is None:
                raise ChatError(f"unknown session: {session_id}")
            session["status"] = status
            session["thought_step"] = thought_step
            session["last_error"] = last_error
            self._persist(data)
            return _copy_session(session)

    def get_session(self, session_id: str) -> ChatSession | None:
        with self._lock:
            session = self._find_session(session_id)
            return _copy_session(session) if session is not None else None

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            data = self._load()
            remaining = [session for session in data["sessions"] if session["id"] != session_id]
            if len(remaining) == len(data["sessions"]):
                raise ChatError(f"unknown session: {session_id}")
            data["sessions"] = remaining
            self._persist(data)

    def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        pinned: bool | None = None,
        project_id: str | _Unset | None = _UNSET,
        book: str | _Unset = _UNSET,
        categories: list[str] | _Unset = _UNSET,
    ) -> ChatSession:
        with self._lock:
            data = self._load()
            session = self._find_session(session_id)
            if session is None:
                raise ChatError(f"unknown session: {session_id}")
            clean_title: str | None = None
            if title is not None:
                clean_title = " ".join(title.split())
                if not clean_title:
                    raise ChatError("title must not be empty")
            if (
                not isinstance(project_id, _Unset)
                and project_id is not None
                and self._find_project(project_id) is None
            ):
                raise ChatError(f"unknown project: {project_id}")
            if clean_title is not None:
                session["title"] = clean_title[:MAX_TITLE]
            if pinned is not None:
                session["pinned"] = pinned
            if not isinstance(project_id, _Unset):
                session["project_id"] = project_id
            if not isinstance(book, _Unset):
                session["book"] = book
            if not isinstance(categories, _Unset):
                session["categories"] = list(dict.fromkeys(categories))
            session["updated"] = time.time()
            self._persist(data)
            return _copy_session(session)

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        sources: list[dict[str, object]] | None = None,
        provider: str = "",
        model: str = "",
    ) -> ChatSession:
        clean_role = role.strip()
        clean_content = content.strip()
        if clean_role not in {"user", "assistant"}:
            raise ChatError("message role must be 'user' or 'assistant'")
        if not clean_content:
            raise ChatError("message content must not be empty")
        if len(clean_content) > MAX_MESSAGE_CHARS:
            raise ChatError(f"message must be at most {MAX_MESSAGE_CHARS} characters")
        with self._lock:
            data = self._load()
            session = self._find_session(session_id)
            if session is None:
                raise ChatError(f"unknown session: {session_id}")
            now = time.time()
            message: StoredMessage = {
                "id": secrets.token_hex(8),
                "role": clean_role,
                "content": clean_content,
                "sources": [dict(source) for source in sources or []],
                "provider": provider,
                "model": model,
                "created": now,
            }
            session["messages"].append(message)
            overflow = len(session["messages"]) - MAX_MESSAGES
            if overflow > 0:
                del session["messages"][:overflow]
            if clean_role == "user" and session["title"] == "New chat":
                session["title"] = " ".join(clean_content.split())[:MAX_TITLE]
            if clean_role == "assistant":
                session["status"] = "idle"
                session["thought_step"] = ""
                session["last_error"] = None
            session["updated"] = now
            self._persist(data)
            return _copy_session(session)

    def list_projects(self) -> list[ChatProject]:
        with self._lock:
            return [cast(ChatProject, dict(project)) for project in self._load()["projects"]]

    def create_project(self, name: str) -> ChatProject:
        clean = " ".join(name.split())
        if not clean:
            raise ChatError("project name must not be empty")
        if len(clean) > MAX_PROJECT_NAME:
            raise ChatError(f"project name must be at most {MAX_PROJECT_NAME} characters")
        with self._lock:
            data = self._load()
            if any(project["name"].casefold() == clean.casefold() for project in data["projects"]):
                raise ChatError(f"project already exists: {clean}")
            project: ChatProject = {
                "id": secrets.token_hex(8),
                "name": clean,
                "created": time.time(),
            }
            data["projects"].append(project)
            self._persist(data)
            return cast(ChatProject, dict(project))

    def delete_project(self, project_id: str) -> int:
        with self._lock:
            data = self._load()
            if self._find_project(project_id) is None:
                raise ChatError(f"unknown project: {project_id}")
            data["projects"] = [
                project for project in data["projects"] if project["id"] != project_id
            ]
            now = time.time()
            count = 0
            for session in data["sessions"]:
                if session["project_id"] == project_id:
                    session["project_id"] = None
                    session["updated"] = now
                    count += 1
            self._persist(data)
            return count
