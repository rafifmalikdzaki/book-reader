import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from book_reader.app import create_app
from book_reader.chat import (
    AskCallbacks,
    AskOptions,
    ChatMessage,
    ChatService,
    ProviderConfig,
    _with_context_source,
    collect_sources,
    resolve_providers,
)
from book_reader.library.scan import Library
from book_reader.notepad import NotepadStore
from book_reader.reading.pdf import PdfCache
from book_reader.reading.sections import SectionIndex
from book_reader.search import Searcher


def build_chat(library: Path, tmp_path: Path) -> ChatService:
    state = tmp_path / "state"
    pdf = PdfCache()
    sections = SectionIndex(state)
    notepad = NotepadStore(state)
    catalogue = Library(library)
    searcher = Searcher(catalogue, pdf, sections, None, "local")
    providers = [ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")]
    return ChatService(catalogue, searcher, pdf, sections, notepad, providers=providers)


def test_gemini_provider_accepts_alias_keys_and_uses_the_openai_endpoint() -> None:
    for key_env in ("GEMINI_API_KEY", "GEMINI_API", "GOOGLE_API_KEY"):
        [provider] = resolve_providers({key_env: "g", "BOOK_READER_CHAT_PRIORITY": "gemini"})
        assert (provider.name, provider.model, provider.api_key) == (
            "gemini",
            "gemini-3.8-flash",
            "g",
        )
        assert provider.base_url.startswith("https://generativelanguage.googleapis.com/")
    assert resolve_providers({"BOOK_READER_CHAT_PRIORITY": "gemini"}) == []


def test_gemini_replayed_tool_calls_carry_a_thought_signature() -> None:
    from book_reader.chat.model import _chat_model

    messages = [
        HumanMessage("hi"),
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "t", "args": {}}]),
        ToolMessage(content="ok", tool_call_id="c1"),
    ]
    gemini = ProviderConfig(name="gemini", base_url="http://x/v1", model="g", api_key="k")
    other = ProviderConfig(name="mistral", base_url="http://x/v1", model="m", api_key="k")

    def tool_call(provider: ProviderConfig) -> dict[str, Any]:
        payload = _chat_model(provider)._get_request_payload(messages)
        return cast(dict[str, Any], payload["messages"][1]["tool_calls"][0])

    assert "thought_signature" in tool_call(gemini)["extra_content"]["google"]
    assert "extra_content" not in tool_call(other)


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
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        options = options or AskOptions()
        return {
            "answer": f"echo:{messages[-1]['content']}",
            "sources": [{"book": options.book or "sub/a.pdf", "page": options.page or 1}],
            "provider": "stub",
            "model": options.model or "m",
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
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        model = (options or AskOptions()).model
        self.seen.append([{"role": m["role"], "content": m["content"]} for m in messages])
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
        options: AskOptions,
        callbacks: AskCallbacks,
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


def test_search_library_respects_allowed_books(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    payload = json.loads(chat._search_library("hello-search-needle", allowed_books={"sub/a.pdf"}))
    assert payload["sources"]
    assert {source["book"] for source in payload["sources"]} == {"sub/a.pdf"}

    empty = json.loads(chat._search_library("hello-search-needle", allowed_books=set()))
    assert empty["sources"] == []

    outside = json.loads(
        chat._search_library("hello-search-needle", book="note.md", allowed_books={"sub/a.pdf"})
    )
    assert "outside the selected scope" in outside["error"]


def test_system_prompt_respects_category_scope(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    prompt = chat._system_prompt(None, None, scope="categories: A", allowed_books={"sub/a.pdf"})
    assert "Retrieval is limited" in prompt
    assert "sub/a.pdf" in prompt
    assert "note.md" not in prompt

    outside = chat._system_prompt("note.md", 1, allowed_books={"sub/a.pdf"})
    assert "currently viewing" not in outside


def test_outline_and_read_section_tools(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    tools = chat.tool_map()

    # Markdown outline and section reading
    md_outline = json.loads(tools["get_book_outline"].invoke({"book": "note.md"}))
    assert md_outline["kind"] == "md"
    assert any("Title" in sec["title"] for sec in md_outline["sections"])

    md_section = json.loads(tools["read_section"].invoke({"book": "note.md", "section": "Title"}))
    assert "snake_case" in md_section["text"]
    assert md_section["sources"][0]["book"] == "note.md"

    # PDF outline and section reading fallback
    pdf_outline = json.loads(tools["get_book_outline"].invoke({"book": "sub/a.pdf"}))
    assert pdf_outline["kind"] == "pdf"
    assert pdf_outline["pages"] >= 1

    pdf_section = json.loads(
        tools["read_section"].invoke(
            {"book": "sub/a.pdf", "section": "hello-search-needle", "max_pages": 2}
        )
    )
    assert "hello-search-needle" in pdf_section["text"]
    assert pdf_section["sources"][0]["book"] == "sub/a.pdf"


def test_list_books_and_read_notes_tools(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    tools = chat.tool_map()

    listed = json.loads(tools["list_books"].invoke({"query": "note"}))
    assert any(item["book"] == "note.md" for item in listed["books"])

    tools["add_note"].invoke(
        {"book": "sub/a.pdf", "quote": "key definition", "comment": "important", "page": 1}
    )
    notes_payload = json.loads(tools["read_notes"].invoke({"book": "sub/a.pdf"}))
    assert len(notes_payload["notes"]) == 1
    assert notes_payload["notes"][0]["quote"] == "key definition"


def test_socratic_tutor_mode_injects_skill(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    teacher_prompt = chat._system_prompt("sub/a.pdf", 1, socratic=False)
    tutor_prompt = chat._system_prompt("sub/a.pdf", 1, socratic=True)
    assert "Master Teacher Mode" in teacher_prompt
    assert "SkillMap" in tutor_prompt
    assert "ONE question per turn" in tutor_prompt


class _FakeRunnable:
    """Stand-in for a bound chat model that records calls and fails on demand."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.invokes = 0
        self.streams = 0

    def invoke(self, _msgs: object) -> AIMessage:
        self.invokes += 1
        if self.error:
            raise self.error
        return AIMessage(content="ok")

    def stream(self, _msgs: object) -> Iterator[AIMessage]:
        self.streams += 1
        if self.error:
            raise self.error
        yield AIMessage(content="ok")


def _run_graph(
    chat: ChatService, bound: _FakeRunnable, **kwargs: Any
) -> dict[str, list[BaseMessage]]:
    provider = ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")
    graph = chat._graph(cast(Any, bound), cast(Any, bound), [], provider=provider, **kwargs)
    return cast(dict[str, list[BaseMessage]], graph.invoke({"messages": [HumanMessage("hi")]}))


def test_provider_error_is_invoked_once(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    bound = _FakeRunnable(RuntimeError("provider down"))
    with pytest.raises(RuntimeError, match="provider down"):
        _run_graph(chat, bound)
    assert bound.invokes == 1


def test_stream_error_falls_back_to_one_invoke(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    bound = _FakeRunnable(RuntimeError("stream broke"))
    with pytest.raises(RuntimeError, match="stream broke"):
        _run_graph(chat, bound, on_token=lambda _delta: None)
    assert (bound.streams, bound.invokes) == (1, 1)


def test_reasoning_effort_rejection_retries_without_it(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    built: list[dict[str, object]] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs: object) -> None:
            built.append(kwargs)

        def invoke(self, _msgs: object) -> AIMessage:
            return AIMessage(content="plain answer")

        def bind_tools(self, _tools: object) -> "FakeChatOpenAI":
            return self

    monkeypatch.setattr("book_reader.chat.model.ChatOpenAI", FakeChatOpenAI)
    chat = build_chat(library, tmp_path)
    for callbacks in ({}, {"on_token": lambda _delta: None}):
        bound = _FakeRunnable(RuntimeError("Unknown parameter: reasoning_effort"))
        result = _run_graph(chat, bound, **callbacks)
        assert result["messages"][-1].content == "plain answer"
        assert bound.invokes <= 1
    assert len(built) == 2
    assert all("reasoning_effort" not in kwargs for kwargs in built)
    assert "test:m" in chat._effort_rejected


def test_effort_is_not_sent_again_to_a_provider_that_rejected_it(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    built: list[dict[str, object]] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs: object) -> None:
            built.append(kwargs)

        def invoke(self, _msgs: object) -> AIMessage:
            return AIMessage(content="ok")

        def bind_tools(self, _tools: object) -> "FakeChatOpenAI":
            return self

    monkeypatch.setattr("book_reader.chat.model.ChatOpenAI", FakeChatOpenAI)
    chat = build_chat(library, tmp_path)
    provider = ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")
    messages: list[ChatMessage] = [{"role": "user", "content": "hi"}]

    chat._run(provider, messages, AskOptions(effort="high"), AskCallbacks())
    chat._effort_rejected.add("test:m")
    chat._run(provider, messages, AskOptions(effort="high"), AskCallbacks())

    assert [kwargs.get("reasoning_effort") for kwargs in built] == ["high", None]


def test_chat_options_validate_effort(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state", chat=cast(ChatService, StubChat()))
    with TestClient(app) as client:
        assert client.get("/api/chat/options").json()["effort"] == "default"

        saved = client.post("/api/chat/options", json={"effort": " HIGH "})
        assert saved.json() == {"ok": True, "effort": "high"}
        assert client.get("/api/chat/options").json()["effort"] == "high"

        bad = client.post("/api/chat/options", json={"effort": "extreme"})
        assert bad.status_code == 400
        assert client.get("/api/chat/options").json()["effort"] == "high"

        # A rejected effort must not half-apply the model choice sent with it.
        both = client.post("/api/chat/options", json={"model": "stub:m", "effort": "extreme"})
        assert both.status_code == 400
        assert client.get("/api/chat/options").json()["selected"] == "auto"


def test_tools_report_found_documents(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    found: list[list[dict[str, object]]] = []
    tools = chat.tool_map(on_found=found.append)
    tools["search_library"].invoke({"query": "hello-search-needle", "book": "sub/a.pdf"})
    tools["list_books"].invoke({})
    assert found[0][0]["book"] == "sub/a.pdf" and found[0][0]["page"] == 1
    assert "needle" in str(found[0][0]["snippet"])
    assert {item["book"] for item in found[1]} >= {"sub/a.pdf"}
