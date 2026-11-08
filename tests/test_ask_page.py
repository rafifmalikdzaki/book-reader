from pathlib import Path
from typing import cast

from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.chat import ChatService, ProviderConfig


class StubChat:
    def available(self) -> bool:
        return True

    def providers(self) -> list[ProviderConfig]:
        return [ProviderConfig(name="stub", base_url="http://localhost", model="m", api_key="k")]

    def model_options(self) -> list[dict[str, str]]:
        return [{"id": "stub:m", "provider": "stub", "model": "m"}]

    def ask(
        self,
        messages: list[dict[str, str]],
        *,
        book: str | None = None,
        page: int | None = None,
        model: str | None = None,
        allowed_books: set[str] | None = None,
        scope: str | None = None,
    ) -> dict[str, object]:
        return {
            "answer": "echo:" + messages[-1]["content"],
            "sources": [{"book": book or "sub/a.pdf", "page": page or 1}],
            "provider": "stub",
            "model": model or "m",
        }


def test_home_links_to_ask_and_reader_keeps_the_rail(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        home = client.get("/")
        assert home.status_code == 200
        assert 'id="ask-link" href="/ask"' in home.text
        assert 'id="chat-toggle"' not in home.text

        reader = client.get("/book/sub/a.pdf")
        assert reader.status_code == 200
        assert 'id="chat-toggle"' in reader.text
        assert 'id="chat-rail-handle"' in reader.text
        assert 'id="ask-link"' not in reader.text


def test_ask_page_has_the_workspace_and_retention_copy(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        page = client.get("/ask")
        assert page.status_code == 200
        assert 'class="ask-shell"' in page.text
        assert 'id="ask-sessions"' in page.text
        assert 'id="scope-picker"' in page.text
        assert 'id="ask-form"' in page.text
        assert "Chats are deleted after 7 days unless pinned or in a project." in page.text
        assert "/static/ask.js" in page.text
        assert 'aria-current="page"' in page.text


def test_session_api_is_registered_in_the_app(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
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
