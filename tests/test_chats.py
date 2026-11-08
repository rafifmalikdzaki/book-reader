import json
from pathlib import Path

import pytest

from book_reader.chats import ChatError, ChatStore


def forge(path: Path, session_id: str, **fields: object) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for session in payload["sessions"]:
        if session["id"] == session_id:
            session.update(fields)
            break
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_retention_boundary(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session()
    updated = float(session["updated"])

    assert store.remove_expired(now=updated + 7 * 86400) == 0
    assert store.get_session(session["id"]) is not None
    assert store.remove_expired(now=updated + 7 * 86400 + 1) == 1
    assert store.get_session(session["id"]) is None


def test_pinned_session_does_not_expire(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session()
    store.update_session(session["id"], pinned=True)
    forge(store.path, session["id"], updated=0.0)
    store.reload()

    assert store.remove_expired(now=2_000_000_000) == 0
    assert store.get_session(session["id"]) is not None


def test_project_session_does_not_expire(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    project = store.create_project("Reading queue")
    session = store.create_session()
    store.update_session(session["id"], project_id=project["id"])
    forge(store.path, session["id"], updated=0.0)
    store.reload()

    assert store.remove_expired(now=2_000_000_000) == 0
    assert store.get_session(session["id"]) is not None


def test_project_delete_unassigns_and_refreshes(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    project = store.create_project("Reading queue")
    session = store.create_session()
    store.update_session(session["id"], project_id=project["id"])
    forge(store.path, session["id"], updated=0.0)
    store.reload()

    assert store.delete_project(project["id"]) == 1
    unassigned = store.get_session(session["id"])
    assert unassigned is not None
    assert unassigned["project_id"] is None
    assert unassigned["updated"] > 0


def test_title_comes_from_first_user_message(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session()
    assert session["title"] == "New chat"

    store.add_message(session["id"], "user", "  Explain   entropy  ")
    updated = store.get_session(session["id"])
    assert updated is not None
    assert updated["title"] == "Explain entropy"

    store.add_message(session["id"], "user", "Another question")
    assert store.get_session(session["id"])["title"] == "Explain entropy"  # type: ignore[index]


def test_message_cap_and_categories(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session(categories=["optimization", "reading"])
    assert session["categories"] == ["optimization", "reading"]
    for index in range(401):
        store.add_message(session["id"], "user", f"m{index}")

    messages = store.get_session(session["id"])["messages"]  # type: ignore[index]
    assert len(messages) == 400
    assert messages[-1]["content"] == "m400"
    assert messages[0]["content"] == "m1"


def test_corrupt_state_recovers(tmp_path: Path) -> None:
    state = tmp_path / "state"
    state.mkdir()
    (state / "chats.json").write_text("{not json", encoding="utf-8")
    store = ChatStore(state)
    assert store.list_sessions() == []
    created = store.create_session()
    assert store.get_session(created["id"]) is not None


def test_project_names_are_unique_and_assignments_validate(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    store.create_project("Reading queue")
    with pytest.raises(ChatError):
        store.create_project(" reading QUEUE ")
    with pytest.raises(ChatError):
        store.create_project("   ")

    session = store.create_session()
    with pytest.raises(ChatError):
        store.update_session(session["id"], project_id="missing")
    with pytest.raises(ChatError):
        store.update_session(session["id"], pinned=True, project_id="missing")
    assert store.get_session(session["id"])["pinned"] is False  # type: ignore[index]
    with pytest.raises(ChatError):
        store.update_session(session["id"], title="  ")
    assert store.get_session(session["id"])["title"] == "New chat"  # type: ignore[index]
    with pytest.raises(ChatError):
        store.add_message(session["id"], "system", "x")
    with pytest.raises(ChatError):
        store.add_message(session["id"], "user", "   ")
    with pytest.raises(ChatError):
        store.delete_session("missing")


def test_remap_follows_moved_books_and_sources(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session(book="old.pdf")
    store.add_message(
        session["id"],
        "assistant",
        "quote",
        sources=[{"book": "old.pdf", "page": 2}],
    )
    assert store.remap({"old.pdf": "new.pdf"}) == 2
    moved = store.get_session(session["id"])
    assert moved is not None
    assert moved["book"] == "new.pdf"
    assert moved["messages"][0]["sources"][0]["book"] == "new.pdf"


def test_retention_is_enforced_without_reload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session()
    monkeypatch.setattr(
        "book_reader.chats.time.time", lambda: float(session["updated"]) + 7 * 86400 + 1
    )
    assert store.get_session(session["id"]) is None


def test_dangling_project_does_not_grant_retention(tmp_path: Path) -> None:
    store = ChatStore(tmp_path / "state")
    session = store.create_session()
    forge(store.path, session["id"], updated=0.0, project_id="missing")
    store.reload()
    assert store.get_session(session["id"]) is None
