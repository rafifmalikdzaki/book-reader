import json
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import BaseMessage, ToolMessage

from book_reader.app import create_app
from book_reader.chat import (
    ChatService,
    ProviderConfig,
    _with_context_source,
    collect_sources,
    resolve_providers,
)
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


class RecordingChat(StubChat):
    def __init__(self, options: list[dict[str, str]] | None = None) -> None:
        self.seen: list[list[dict[str, str]]] = []
        self.models: list[str | None] = []
        self.options = options or [{"id": "stub:m", "provider": "stub", "model": "m"}]

    def model_options(self) -> list[dict[str, str]]:
        return self.options

    def ask(
        self,
        messages: list[dict[str, str]],
        *,
        book: str | None = None,
        page: int | None = None,
        model: str | None = None,
    ) -> dict[str, object]:
        self.seen.append([dict(message) for message in messages])
        self.models.append(model)
        return {
            "answer": "ok",
            "sources": [],
            "provider": "stub",
            "model": model or "m",
        }


def test_chat_keeps_the_newest_messages(library: Path, tmp_path: Path) -> None:
    chat = RecordingChat()
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, chat))
    with TestClient(app) as client:
        messages = [{"role": "user", "content": f"m{index}"} for index in range(60)]
        assert client.post("/api/chat", json={"messages": messages}).status_code == 200
    received = chat.seen[-1]
    assert len(received) == 50
    assert received[0]["content"] == "m10"
    assert received[-1]["content"] == "m59"


def test_stale_saved_model_falls_back_to_auto(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    first = RecordingChat()
    app = create_app(library, state, chat=cast(ChatService, first))
    with TestClient(app) as client:
        assert client.post("/api/chat/options", json={"model": "stub:m"}).status_code == 200

    app.state.state_dir_lock.release()  # simulate a process restart

    second = RecordingChat([{"id": "other:x", "provider": "other", "model": "x"}])
    app = create_app(library, state, chat=cast(ChatService, second))
    with TestClient(app) as client:
        response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        assert response.status_code == 200
        assert second.models[-1] == "auto"
        explicit = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "hi"}], "model": "stub:m"},
        )
        assert explicit.status_code == 400


def test_chat_returns_503_without_the_agent_extra(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    monkeypatch.setitem(sys.modules, "book_reader.chat", None)
    app = create_app(library, tmp_path / "state")
    with TestClient(app) as client:
        response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 503


def test_ask_falls_through_when_a_provider_returns_no_answer(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from book_reader.chat import ChatError, ChatMessage, ProviderConfig

    chat = build_chat(library, tmp_path)
    first = chat.providers()[0]
    backup = ProviderConfig(
        name="backup",
        base_url=first.base_url,
        model=first.model,
        api_key=first.api_key,
    )
    monkeypatch.setattr(chat, "_providers", [first, backup])
    calls: list[str] = []

    def fake_run(
        provider: ProviderConfig,
        messages: list[ChatMessage],
        *,
        book: str | None,
        page: int | None,
    ) -> dict[str, object]:
        calls.append(provider.name)
        if provider.name == "test":
            raise RuntimeError("provider returned an empty answer")
        return {
            "answer": "second",
            "sources": [],
            "provider": provider.name,
            "model": provider.model,
        }

    monkeypatch.setattr(chat, "_run", fake_run)
    result = chat.ask([{"role": "user", "content": "hi"}])
    assert result["answer"] == "second"
    assert calls == ["test", "backup"]

    def always_fail(*args: object, **kwargs: object) -> dict[str, object]:
        raise RuntimeError("boom")

    monkeypatch.setattr(chat, "_run", always_fail)
    with pytest.raises(ChatError):
        chat.ask([{"role": "user", "content": "hi"}])


def test_empty_final_answer_triggers_provider_fallback(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from langchain_core.messages import AIMessage

    from book_reader.chat import ChatError

    class EmptyGraph:
        def invoke(self, state: object, config: object) -> dict[str, list[object]]:
            return {"messages": [AIMessage(content="")]}

    chat = build_chat(library, tmp_path)
    monkeypatch.setattr(chat, "_graph", lambda *args, **kwargs: EmptyGraph())
    with pytest.raises(ChatError, match="empty answer"):
        chat.ask([{"role": "user", "content": "hi"}])


def test_context_page_is_a_source_only_with_real_excerpt() -> None:
    assert _with_context_source([], "sub/a.pdf", 2, excerpt="") == []
    assert _with_context_source([], "sub/a.pdf", 2, excerpt="real page text") == [
        {"book": "sub/a.pdf", "page": 2}
    ]
    assert _with_context_source(
        [{"book": "sub/a.pdf", "page": 2}], "sub/a.pdf", 2, excerpt="real page text"
    ) == [{"book": "sub/a.pdf", "page": 2}]
    assert _with_context_source([{"book": "x.md", "line": 4}], None, None, excerpt="") == [
        {"book": "x.md", "line": 4}
    ]
