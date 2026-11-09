"""API tests for the persistent Ask session routes."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.chat import AskCallbacks, AskOptions, ChatMessage, ChatService, ProviderConfig
from book_reader.chats import ChatStore
from book_reader.library.scan import Library
from book_reader.organize import CategoryStore
from book_reader.routes_chat_sessions import register
from book_reader.state.preferences import Preferences

ANSWER = "Equilibrium optimization is discussed in alpha."


class FakeReconciler:
    """Stand-in for LibraryReconciler's content ids and rename log."""

    def __init__(self, content_ids: dict[str, str], moves: dict[str, str] | None = None) -> None:
        self.content_ids = content_ids
        self.moves = moves or {}

    def resolve(self, rel: str) -> str:
        return self.moves.get(rel, rel)

    def content_id(self, rel: str) -> str | None:
        return self.content_ids.get(rel)


class StubChat:
    """Records ask calls and optionally fails like the real service."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.failure: Exception | None = None

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        options = options or AskOptions()
        self.calls.append(
            {
                "messages": messages,
                "book": options.book,
                "page": options.page,
                "model": options.model,
                "allowed_books": options.allowed_books,
                "scope": options.scope,
            }
        )
        if self.failure is not None:
            raise self.failure
        return {
            "answer": ANSWER,
            "sources": [{"book": options.book, "page": options.page}],
            "provider": "stub",
            "model": options.model or "auto",
        }


@dataclass
class Harness:
    client: TestClient
    chats: ChatStore
    chat: StubChat
    state: Path
    library_root: Path
    reconciler: FakeReconciler


def make_harness(
    tmp_path: Path, *, with_chat: bool = True, chat: StubChat | None = None
) -> Harness:
    library_root = tmp_path / "library"
    library_root.mkdir()
    (library_root / "alpha.md").write_text(
        "# Alpha\n\nEquilibrium optimization.\n", encoding="utf-8"
    )
    (library_root / "beta.md").write_text("# Beta\n\nReading queue notes.\n", encoding="utf-8")

    state = tmp_path / "state"
    state.mkdir()
    chats = ChatStore(state)
    categories = CategoryStore(state)
    categories.save_taxonomy(
        [
            {"id": "optimization", "name": "Optimization", "description": ""},
            {"id": "reading", "name": "Reading", "description": ""},
        ]
    )
    categories.save_assignments(
        {
            "hash-alpha": {"category": "optimization", "confidence": 1.0, "updated": 0.0},
            "hash-beta": {"category": "reading", "confidence": 1.0, "updated": 0.0},
        }
    )
    reconciler = FakeReconciler({"alpha.md": "hash-alpha", "beta.md": "hash-beta"})
    stub = chat or StubChat()
    app = FastAPI()
    register(
        app,
        chats=chats,
        library=Library(library_root),
        categories=categories,
        chat=cast(Any, stub) if with_chat else None,
        preferences=Preferences(state),
        reconciler=cast(Any, reconciler),
    )
    return Harness(TestClient(app), chats, stub, state, library_root, reconciler)


def create_session(harness: Harness, **body: object) -> dict[str, Any]:
    response = harness.client.post("/api/chat/sessions", json=body)
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def forge_updated(path: Path, session_id: str, updated: float) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for session in payload["sessions"]:
        if session["id"] == session_id:
            session["updated"] = updated
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_create_list_and_delete_session(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness, book="alpha.md", page=3, categories=["optimization"])

    assert session["book"] == "alpha.md"
    assert session["page"] == 3
    assert session["categories"] == ["optimization"]
    assert session["pinned"] is False
    assert session["project_id"] is None
    assert session["messages"] == []

    listing = harness.client.get("/api/chat/sessions").json()
    assert listing["retention_days"] == 7
    assert [item["id"] for item in listing["categories"]] == ["optimization", "reading"]
    assert listing["projects"] == []
    assert [item["id"] for item in listing["sessions"]] == [session["id"]]
    assert listing["sessions"][0]["message_count"] == 0

    fetched = harness.client.get(f"/api/chat/sessions/{session['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == session["id"]

    assert harness.client.delete(f"/api/chat/sessions/{session['id']}").json() == {"ok": True}
    assert harness.client.get(f"/api/chat/sessions/{session['id']}").status_code == 404
    assert harness.client.delete(f"/api/chat/sessions/{session['id']}").status_code == 404


def test_create_validates_book_page_and_categories(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)

    assert harness.client.post("/api/chat/sessions", json={"book": "missing.md"}).status_code == 404
    assert (
        harness.client.post("/api/chat/sessions", json={"book": "../outside.md"}).status_code == 400
    )
    assert (
        harness.client.post("/api/chat/sessions", json={"categories": ["nope"]}).status_code == 400
    )
    assert harness.client.post("/api/chat/sessions", json={"page": 0}).status_code == 422
    assert harness.client.get("/api/chat/sessions/nope").status_code == 404


def test_create_follows_a_moved_book(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    harness.reconciler.moves["old.md"] = "alpha.md"

    session = create_session(harness, book="old.md")
    assert session["book"] == "alpha.md"


def test_patch_uses_field_sentinels(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)
    project = harness.client.post("/api/chat/projects", json={"name": "Queue"}).json()

    patched = harness.client.patch(
        f"/api/chat/sessions/{session['id']}",
        json={"title": "  My   chat ", "pinned": True, "project_id": project["id"]},
    ).json()
    assert patched["title"] == "My chat"
    assert patched["pinned"] is True
    assert patched["project_id"] == project["id"]

    # Omitting project_id must not clear it.
    repinned = harness.client.patch(
        f"/api/chat/sessions/{session['id']}", json={"pinned": False}
    ).json()
    assert repinned["project_id"] == project["id"]
    assert repinned["title"] == "My chat"
    assert repinned["pinned"] is False

    cleared = harness.client.patch(
        f"/api/chat/sessions/{session['id']}", json={"project_id": None}
    ).json()
    assert cleared["project_id"] is None

    scoped = harness.client.patch(
        f"/api/chat/sessions/{session['id']}", json={"categories": ["reading"]}
    ).json()
    assert scoped["categories"] == ["reading"]

    assert (
        harness.client.patch(
            f"/api/chat/sessions/{session['id']}", json={"project_id": "missing"}
        ).status_code
        == 400
    )
    assert (
        harness.client.patch(
            f"/api/chat/sessions/{session['id']}", json={"categories": ["bogus"]}
        ).status_code
        == 400
    )
    assert (
        harness.client.patch(
            f"/api/chat/sessions/{session['id']}", json={"title": "   "}
        ).status_code
        == 400
    )
    assert (
        harness.client.patch(
            f"/api/chat/sessions/{session['id']}", json={"title": None}
        ).status_code
        == 400
    )
    assert (
        harness.client.patch(
            f"/api/chat/sessions/{session['id']}", json={"pinned": None}
        ).status_code
        == 400
    )
    assert harness.client.patch(f"/api/chat/sessions/{session['id']}", json={}).status_code == 400
    assert harness.client.patch("/api/chat/sessions/missing", json={}).status_code == 404


def test_project_crud(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    assert harness.client.get("/api/chat/projects").json() == {"projects": []}

    created = harness.client.post("/api/chat/projects", json={"name": "  Reading   queue "})
    assert created.status_code == 201
    project = created.json()
    assert project["name"] == "Reading queue"

    assert (
        harness.client.post("/api/chat/projects", json={"name": "reading QUEUE"}).status_code == 400
    )
    assert harness.client.post("/api/chat/projects", json={"name": "  "}).status_code == 400

    assert harness.client.delete(f"/api/chat/projects/{project['id']}").json() == {"ok": True}
    assert harness.client.get("/api/chat/projects").json() == {"projects": []}
    assert harness.client.delete(f"/api/chat/projects/{project['id']}").status_code == 400


def test_deleting_a_project_unassigns_its_sessions(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)
    project = harness.client.post("/api/chat/projects", json={"name": "Queue"}).json()
    harness.client.patch(f"/api/chat/sessions/{session['id']}", json={"project_id": project["id"]})

    harness.client.delete(f"/api/chat/projects/{project['id']}")

    remaining = harness.client.get(f"/api/chat/sessions/{session['id']}").json()
    assert remaining["project_id"] is None


def test_message_persists_answer_and_sources(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness, book="alpha.md", page=2, categories=["optimization"])

    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages",
        json={"content": "  What is equilibrium optimization?  "},
    )
    assert response.status_code == 200, response.text
    messages = response.json()["session"]["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "What is equilibrium optimization?"
    assert messages[1]["content"] == ANSWER
    assert messages[1]["sources"] == [{"book": "alpha.md", "page": 2}]
    assert messages[1]["provider"] == "stub"
    assert messages[1]["model"] == "auto"

    call = harness.chat.calls[-1]
    assert call["book"] == "alpha.md"
    assert call["page"] == 2
    assert call["model"] == "auto"
    assert call["allowed_books"] == {"alpha.md"}
    assert call["scope"] == "categories: Optimization"
    assert call["messages"] == [{"role": "user", "content": "What is equilibrium optimization?"}]

    stored = harness.client.get(f"/api/chat/sessions/{session['id']}").json()
    assert [message["content"] for message in stored["messages"]] == [
        "What is equilibrium optimization?",
        ANSWER,
    ]


def test_messages_default_to_the_whole_library(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)

    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "Compare the books."}
    )
    assert response.status_code == 200
    call = harness.chat.calls[-1]
    assert call["allowed_books"] is None
    assert call["scope"] is None


def test_categories_narrow_allowed_books(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    both = create_session(harness, categories=["reading", "optimization"])
    harness.client.post(
        f"/api/chat/sessions/{both['id']}/messages", json={"content": "Trace the idea."}
    )
    call = harness.chat.calls[-1]
    assert call["allowed_books"] == {"alpha.md", "beta.md"}
    assert call["scope"] == "categories: Optimization, Reading"

    reading = create_session(harness, categories=["reading"])
    harness.client.post(
        f"/api/chat/sessions/{reading['id']}/messages", json={"content": "Only reading."}
    )
    assert harness.chat.calls[-1]["allowed_books"] == {"beta.md"}
    assert harness.chat.calls[-1]["scope"] == "categories: Reading"


def test_message_refreshes_a_moved_book_context(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness, book="alpha.md", page=4)
    harness.reconciler.moves["alpha.md"] = "beta.md"

    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "Where is this?"}
    )
    assert response.status_code == 200
    assert response.json()["session"]["book"] == "beta.md"
    assert harness.chat.calls[-1]["book"] == "beta.md"
    assert harness.chat.calls[-1]["page"] == 4


def test_message_validation(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)
    url = f"/api/chat/sessions/{session['id']}/messages"

    assert harness.client.post(url, json={"content": "   "}).status_code == 400
    assert harness.client.post(url, json={"content": "x" * 8001}).status_code == 400
    assert (
        harness.client.post(
            "/api/chat/sessions/missing/messages", json={"content": "hi"}
        ).status_code
        == 404
    )
    assert harness.client.post(url, json={}).status_code == 422
    assert harness.client.get(f"/api/chat/sessions/{session['id']}").json()["messages"] == []


def test_message_without_chat_service_keeps_history(tmp_path: Path) -> None:
    harness = make_harness(tmp_path, with_chat=False)
    session = create_session(harness)

    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "Hello?"}
    )
    assert response.status_code == 503
    stored = harness.client.get(f"/api/chat/sessions/{session['id']}").json()
    assert stored["messages"] == []


def test_failed_provider_keeps_the_user_message(tmp_path: Path) -> None:
    from book_reader.chat import ChatError, ChatUnavailable

    harness = make_harness(tmp_path)
    session = create_session(harness)
    url = f"/api/chat/sessions/{session['id']}/messages"

    harness.chat.failure = ChatUnavailable("no provider key")
    assert harness.client.post(url, json={"content": "First try"}).status_code == 503
    stored = harness.client.get(f"/api/chat/sessions/{session['id']}").json()
    assert [message["role"] for message in stored["messages"]] == ["user"]
    assert stored["messages"][0]["content"] == "First try"

    harness.chat.failure = ChatError("all providers failed")
    assert harness.client.post(url, json={"content": "Second try"}).status_code == 502
    stored = harness.client.get(f"/api/chat/sessions/{session['id']}").json()
    assert [message["content"] for message in stored["messages"]] == ["First try", "Second try"]


def test_expired_session_is_pruned_on_read(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)
    forge_updated(harness.state / "chats.json", session["id"], 0.0)
    harness.chats.reload()

    assert harness.client.get(f"/api/chat/sessions/{session['id']}").status_code == 404
    assert harness.client.get("/api/chat/sessions").json()["sessions"] == []


def test_pinned_session_survives_retention(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)
    harness.client.patch(f"/api/chat/sessions/{session['id']}", json={"pinned": True})
    forge_updated(harness.state / "chats.json", session["id"], 0.0)
    harness.chats.reload()

    assert harness.client.get(f"/api/chat/sessions/{session['id']}").status_code == 200


def test_message_keeps_a_vanished_book_context(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness, book="alpha.md")
    harness.chats.update_session(session["id"], book="gone.md")

    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "Still there?"}
    )
    assert response.status_code == 200
    assert response.json()["session"]["book"] == "gone.md"
    assert harness.chat.calls[-1]["book"] == "gone.md"


class StubAppChat:
    def available(self) -> bool:
        return True

    def providers(self) -> list[ProviderConfig]:
        return [ProviderConfig(name="stub", base_url="http://localhost", model="m", api_key="k")]

    def model_options(self) -> list[dict[str, str]]:
        return [{"id": "stub:m", "provider": "stub", "model": "m"}]

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        options = options or AskOptions()
        return {
            "answer": "echo:" + messages[-1]["content"],
            "sources": [{"book": options.book or "sub/a.pdf", "page": options.page or 1}],
            "provider": "stub",
            "model": options.model or "m",
        }


def test_session_api_is_registered_in_the_app(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubAppChat()))
    with TestClient(app) as client:
        listed = client.get("/api/chat/sessions").json()
        assert listed["retention_days"] == 7
        assert listed["categories"] == []
        assert listed["sessions"] == []

        created = client.post(
            "/api/chat/sessions",
            json={"book": "sub/a.pdf", "page": 2},
        )
        assert created.status_code == 201
        session = created.json()
        assert session["book"] == "sub/a.pdf"
        assert session["categories"] == []

        answered = client.post(
            f"/api/chat/sessions/{session['id']}/messages",
            json={"content": "What is here?"},
        )
        assert answered.status_code == 200, answered.text
        stored = answered.json()["session"]
        assert [message["role"] for message in stored["messages"]] == ["user", "assistant"]
        assert stored["messages"][1]["sources"] == [{"book": "sub/a.pdf", "page": 2}]
        assert stored["title"] == "What is here?"


def test_session_events_stream_and_conflict_when_thinking(tmp_path: Path) -> None:
    harness = make_harness(tmp_path)
    session = create_session(harness)

    # Events endpoint streams initial status
    with harness.client.stream("GET", f"/api/chat/sessions/{session['id']}/events") as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        line = next(response.iter_lines())
        assert line.startswith("data: ")
        data = json.loads(line.removeprefix("data: "))
        assert data["type"] == "status"
        assert data["status"] == "idle"

    # Mark thinking to verify conflict guard
    harness.chats.set_session_status(session["id"], "thinking", thought_step="Searching…")
    conflict = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages",
        json={"content": "Duplicate send"},
    )
    assert conflict.status_code == 409
    assert "already generating" in conflict.json()["detail"]

    # Cancel endpoint resets session status to idle
    cancelled = harness.client.post(f"/api/chat/sessions/{session['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["session"]["status"] == "idle"


def test_thought_steps_round_trip_through_store(tmp_path: Path) -> None:
    store = ChatStore(tmp_path)
    session = store.create_session()
    store.add_message(session["id"], "user", "why?")
    store.add_message(
        session["id"], "assistant", "because", thought_steps=["Searching library…", "", "Reading"]
    )

    reloaded = ChatStore(tmp_path).get_session(session["id"])
    assert reloaded is not None
    user, assistant = reloaded["messages"]
    assert "thought_steps" not in user
    assert assistant["thought_steps"] == ["Searching library…", "Reading"]


class StepsOnlyChat(StubChat):
    """A backend that echoes steps in its result without calling on_step."""

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        result = super().ask(messages, options, callbacks)
        result["thought_steps"] = ["Read page 2", "", "Read page 3"]
        return result


class CallbackChat(StubChat):
    """A backend that reports blank, repeated and real steps through the callbacks."""

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        assert callbacks is not None and callbacks.on_step is not None
        for step in ("  ", "Searching…", "Searching…", "Reading"):
            callbacks.on_step(step)
        return super().ask(messages, options, callbacks)


def last_message_steps(harness: Harness) -> list[str]:
    session = create_session(harness)
    response = harness.client.post(
        f"/api/chat/sessions/{session['id']}/messages", json={"content": "why?"}
    )
    assert response.status_code == 200, response.text
    stored = harness.chats.get_session(str(session["id"]))
    assert stored is not None
    return list(stored["messages"][-1].get("thought_steps", []))


def test_persisted_steps_come_from_the_callbacks_not_the_result(tmp_path: Path) -> None:
    harness = make_harness(tmp_path, chat=StepsOnlyChat())
    assert last_message_steps(harness) == ["Searching library…"]


def test_blank_and_repeated_callback_steps_are_dropped(tmp_path: Path) -> None:
    harness = make_harness(tmp_path, chat=CallbackChat())
    assert last_message_steps(harness) == ["Searching library…", "Searching…", "Reading"]


class FoundChat(StubChat):
    """Reports found documents only once a live subscriber is attached."""

    def __init__(self) -> None:
        super().__init__()
        self.subscribed = threading.Event()

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        assert callbacks is not None and callbacks.on_found is not None
        assert self.subscribed.wait(5)
        callbacks.on_found([{"book": "sub/a.pdf", "page": 1, "snippet": "needle"}])
        callbacks.on_found([{"book": "sub/a.pdf", "page": 1}, {"book": "b.md", "line": 4}])
        return super().ask(messages, options, callbacks)


def test_found_documents_stream_cumulatively_and_deduplicated(tmp_path: Path) -> None:
    chat = FoundChat()
    harness = make_harness(tmp_path, chat=chat)
    session = create_session(harness)
    sid = str(session["id"])
    sender = threading.Thread(
        target=lambda: harness.client.post(
            f"/api/chat/sessions/{sid}/messages", json={"content": "q"}
        )
    )
    sender.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        stored = harness.chats.get_session(sid)
        if stored is not None and stored["status"] == "thinking":
            break
        time.sleep(0.02)
    found: list[dict[str, object]] = []
    with harness.client.stream("GET", f"/api/chat/sessions/{sid}/events") as response:
        lines = response.iter_lines()
        assert json.loads(next(lines).removeprefix("data: "))["status"] == "thinking"
        chat.subscribed.set()
        for line in lines:
            if not line.startswith("data: "):
                continue
            event = json.loads(line.removeprefix("data: "))
            if event["type"] == "found":
                found = event["found"]
            if event["type"] == "done":
                break
    sender.join(5)
    assert found == [
        {"book": "sub/a.pdf", "page": 1, "snippet": "needle"},
        {"book": "b.md", "line": 4},
    ]
