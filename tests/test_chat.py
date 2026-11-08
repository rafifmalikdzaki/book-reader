import json
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import BaseMessage, ToolMessage

from book_reader.app import create_app
from book_reader.chat import ChatService, ProviderConfig, collect_sources, resolve_providers
from book_reader.library import Library
from book_reader.notepad import NotepadStore
from book_reader.pdf import PdfCache
from book_reader.search import Searcher
from book_reader.sections import SectionIndex


def build_chat(library: Path, tmp_path: Path) -> ChatService:
    state = tmp_path / "state"
    pdf = PdfCache()
    sections = SectionIndex(state)
    notepad = NotepadStore(state)
    catalogue = Library(library)
    searcher = Searcher(catalogue, pdf, sections, None, "local")
    providers = [ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")]
    return ChatService(catalogue, searcher, pdf, sections, notepad, providers=providers)


def test_provider_order_and_missing_keys() -> None:
    env = {
        "INCEPTION_API_KEY": "a",
        "OLLAMA_API_KEY": "c",
        "BOOK_READER_CHAT_PROVIDERS": "inception,openrouter,ollama",
    }
    assert [provider.name for provider in resolve_providers(env)] == ["inception", "ollama"]
    assert resolve_providers(env)[0].model == "mercury-3"

    env["BOOK_READER_INCEPTION_MODEL"] = "mercury-2"
    assert resolve_providers(env)[0].model == "mercury-2"


def test_search_tool_returns_locators(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    payload = json.loads(
        chat.tool_map()["search_library"].invoke(
            {"query": "hello-search-needle", "book": "sub/a.pdf"}
        )
    )
    assert payload["sources"][0]["book"] == "sub/a.pdf"
    assert payload["sources"][0]["page"] == 1


def test_read_tool_returns_page_text(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    payload = json.loads(
        chat.tool_map()["read_document"].invoke({"book": "sub/a.pdf", "page": 1, "count": 1})
    )
    assert "hello-search-needle" in payload["text"]
    assert payload["sources"][0]["page"] == 1


def test_note_tool_persists(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    payload = json.loads(
        chat.tool_map()["add_note"].invoke(
            {"book": "sub/a.pdf", "quote": "hello-search-needle", "comment": "c", "page": 1}
        )
    )
    assert payload["saved"] is True
    notes = NotepadStore(tmp_path / "state").notes()
    assert [note["quote"] for note in notes] == ["hello-search-needle"]


def test_collect_sources_dedupes() -> None:
    messages: list[BaseMessage] = [
        ToolMessage(
            content=json.dumps({"sources": [{"book": "a.pdf", "page": 1}]}), tool_call_id="1"
        ),
        ToolMessage(
            content=json.dumps(
                {"sources": [{"book": "a.pdf", "page": 1}, {"book": "b.md", "line": 4}]}
            ),
            tool_call_id="2",
        ),
    ]
    assert collect_sources(messages) == [
        {"book": "a.pdf", "page": 1},
        {"book": "b.md", "line": 4},
    ]


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
    ) -> dict[str, object]:
        return {
            "answer": f"echo:{messages[-1]['content']}",
            "sources": [{"book": book or "sub/a.pdf", "page": page or 1}],
            "provider": "stub",
            "model": model or "m",
        }


def test_chat_route_uses_injected_service(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "book": "sub/a.pdf",
                "page": 2,
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "echo:hi"
    assert payload["sources"] == [{"book": "sub/a.pdf", "page": 2}]


def test_chat_route_rejects_bad_messages(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        assert client.post("/api/chat", json={"messages": []}).status_code == 400
        bad = client.post("/api/chat", json={"messages": [{"role": "system", "content": "x"}]})
        assert bad.status_code == 400


def test_chat_unavailable_without_keys(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for key in ("INCEPTION_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("BOOK_READER_CHAT_PROVIDERS", "inception,openrouter,ollama")
    app = create_app(library, tmp_path / "state")
    with TestClient(app) as client:
        assert client.get("/api/chat/status").json()["available"] is False
        response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        assert response.status_code == 503


def test_chat_options_persist_selection(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        options = client.get("/api/chat/options").json()
        assert options["selected"] == "auto"
        assert options["models"] == [{"id": "stub:m", "provider": "stub", "model": "m"}]

        saved = client.post("/api/chat/options", json={"model": "stub:m"})
        assert saved.json() == {"ok": True, "selected": "stub:m"}
        assert client.get("/api/chat/options").json()["selected"] == "stub:m"

        response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        assert response.json()["model"] == "stub:m"

        assert client.post("/api/chat/options", json={"model": "nope:x"}).status_code == 400


def test_mistral_priority_entries() -> None:
    env = {
        "MISTRAL_API": "key",
        "BOOK_READER_CHAT_PRIORITY": (
            "mistral:mistral-small-latest,mistral:ministral-8b-latest,"
            "mistral:zai-glm-5-3-flash,inception:mercury-3"
        ),
    }
    providers = resolve_providers(env)
    assert [(provider.name, provider.model) for provider in providers] == [
        ("mistral", "mistral-small-latest"),
        ("mistral", "ministral-8b-latest"),
        ("mistral", "zai-glm-5-3-flash"),
    ]


def test_default_priority_offers_free_openrouter_models() -> None:
    providers = resolve_providers({"OPENROUTER_API_KEY": "key"})
    assert [(provider.name, provider.model) for provider in providers] == [
        ("openrouter", "openrouter/free"),
        ("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"),
    ]
