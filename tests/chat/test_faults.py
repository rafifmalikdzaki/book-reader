"""Fault-injection tests: malformed model responses, agent-loop faults, provider failures.

These probe the chat system for faults in three surfaces:
- response: how model output (empty, whitespace, None, content blocks) is handled
- tasks: agent step tracking and the tool-loop routing (errors, round cap)
- system: provider fallback chain and option validation
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from book_reader.chat.model import _chunk_text, _message_text
from book_reader.chat.service import ChatService
from book_reader.chat.types import AskCallbacks, AskOptions, ChatError, ProviderConfig


def build_chat(library: Path, tmp_path: Path) -> ChatService:
    from book_reader.library.scan import Library
    from book_reader.notes.store import NotepadStore
    from book_reader.reading.pdf import PdfCache
    from book_reader.reading.sections import SectionIndex
    from book_reader.search.service import Searcher

    state = tmp_path / "state"
    pdf = PdfCache()
    sections = SectionIndex(state)
    notepad = NotepadStore(state)
    catalogue = Library(library)
    searcher = Searcher(catalogue, pdf, sections, None, "local")
    providers = [ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")]
    return ChatService(catalogue, searcher, pdf, sections, notepad, providers=providers)


PROVIDER = ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")


# ---- response faults: model output handling ---------------------------------


def test_message_text_none_content_is_empty_not_the_string_none() -> None:
    # A model returning content=None must not surface the literal string "None" as the answer.
    assert _message_text(None) == ""


def test_message_text_flattens_mixed_content_blocks() -> None:
    content: object = [
        "plain part",
        {"type": "text", "text": "block part"},
        {"type": "tool_use", "name": "no text here"},
        {"text": 42},
        ["nested", "list"],
    ]
    assert _message_text(content) == "plain part block part"


def test_chunk_text_ignores_non_text_blocks() -> None:
    assert _chunk_text(None) == ""
    assert _chunk_text({"type": "tool_use"}) == ""
    assert _chunk_text([{"type": "text", "text": "a"}, "b", {"no_text": 1}]) == "ab"


def test_whitespace_only_final_answer_uses_extractive_fallback(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chat = build_chat(library, tmp_path)

    class SourceOnlyGraph:
        def invoke(self, state: object, config: object) -> dict[str, list[BaseMessage]]:
            messages = list(cast(dict[str, list[BaseMessage]], state)["messages"])
            messages.append(
                ToolMessage(
                    content=json.dumps(
                        {"sources": [{"book": "sub/a.pdf", "page": 1, "snippet": "needle text"}]}
                    ),
                    tool_call_id="1",
                )
            )
            messages.append(AIMessage(content="   "))
            return {"messages": messages}

    monkeypatch.setattr(chat, "_graph", lambda *args, **kwargs: SourceOnlyGraph())
    result = chat._run(PROVIDER, [{"role": "user", "content": "hi"}], AskOptions(), AskCallbacks())
    assert result["fallback"] == "extractive"
    assert str(result["answer"]).startswith("Relevant passages found:")
    assert "sub/a.pdf#p1" in str(result["answer"])


# ---- task faults: agent loop routing and step tracking -----------------------


class StubRunnable:
    """Bound-model stand-in with scripted invoke results."""

    def __init__(self, results: list[AIMessage]) -> None:
        self.results = list(results)
        self.invokes = 0

    def invoke(self, _msgs: object) -> AIMessage:
        self.invokes += 1
        return self.results.pop(0) if self.results else AIMessage(content="done")

    def stream(self, _msgs: object) -> Any:
        raise AssertionError("stream not expected in these tests")


@tool
def failing_tool() -> str:
    """Always reports an error."""
    return "Error: disk gone"


@tool
def ok_tool() -> str:
    """Always succeeds."""
    return "ok data"


def test_tool_error_routes_straight_to_finish(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    bound = StubRunnable(
        [AIMessage(content="", tool_calls=[{"name": "failing_tool", "args": {}, "id": "c1"}])]
    )
    plain = StubRunnable([AIMessage(content="recovered answer")])
    graph = chat._graph(cast(Any, bound), cast(Any, plain), [failing_tool], provider=PROVIDER)
    result = graph.invoke({"messages": [HumanMessage("hi")]})
    messages = cast(list[BaseMessage], result["messages"])
    assert str(messages[-1].content) == "recovered answer"
    tool_msgs = [m for m in messages if isinstance(m, ToolMessage)]
    assert tool_msgs and str(tool_msgs[-1].content).startswith("Error")


def test_tool_round_cap_terminates_the_loop(library: Path, tmp_path: Path) -> None:
    from book_reader.chat.limits import MAX_TOOL_ROUNDS

    chat = build_chat(library, tmp_path)
    # The model keeps requesting tools forever; the round cap must stop the loop.
    bound = StubRunnable(
        [
            AIMessage(content="", tool_calls=[{"name": "ok_tool", "args": {}, "id": f"c{i}"}])
            for i in range(MAX_TOOL_ROUNDS + 5)
        ]
    )
    plain = StubRunnable([AIMessage(content="capped answer")])
    graph = chat._graph(cast(Any, bound), cast(Any, plain), [ok_tool], provider=PROVIDER)
    result = graph.invoke({"messages": [HumanMessage("hi")]})
    messages = cast(list[BaseMessage], result["messages"])
    assert str(messages[-1].content) == "capped answer"
    assert bound.invokes == MAX_TOOL_ROUNDS


def test_thought_steps_dedupe_and_drop_empty(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chat = build_chat(library, tmp_path)

    def capture_graph(*args: object, **kwargs: Any) -> Any:
        on_step = kwargs["on_step"]

        class StepGraph:
            def invoke(self, state: object, config: object) -> dict[str, list[BaseMessage]]:
                on_step("Reasoning about next step…")
                on_step("Reasoning about next step…")
                on_step("   ")
                on_step("Synthesizing teaching response from retrieved sources…")
                messages = list(cast(dict[str, list[BaseMessage]], state)["messages"])
                messages.append(AIMessage(content="ans"))
                return {"messages": messages}

        return StepGraph()

    monkeypatch.setattr(chat, "_graph", capture_graph)
    result = chat._run(PROVIDER, [{"role": "user", "content": "hi"}], AskOptions(), AskCallbacks())
    assert result["thought_steps"] == [
        "Starting research agent…",
        "Reasoning about next step…",
        "Synthesizing teaching response from retrieved sources…",
    ]


# ---- system faults: provider chain and options --------------------------------


def test_unknown_model_option_raises_chat_error(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    with pytest.raises(ChatError, match="unknown model"):
        chat.ask([{"role": "user", "content": "hi"}], AskOptions(model="nope:x"))


def test_all_providers_failing_reports_each_failure(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chat = build_chat(library, tmp_path)
    chat._providers = [
        PROVIDER,
        ProviderConfig(name="backup", base_url="http://localhost", model="m", api_key="k"),
    ]

    def fake_run(provider: ProviderConfig, *args: object, **kwargs: object) -> dict[str, object]:
        raise RuntimeError(f"{provider.name} exploded")

    monkeypatch.setattr(chat, "_run", fake_run)
    with pytest.raises(ChatError) as excinfo:
        chat.ask([{"role": "user", "content": "hi"}])
    message = str(excinfo.value)
    assert "test exploded" in message and "backup exploded" in message
