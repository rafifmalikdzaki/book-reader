"""Steering selection: which prompt modules and tools one question pays for."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import AIMessage
from langchain_core.tools import BaseTool

from book_reader.chat.guidance import READ_TOOLS, select_guidance
from book_reader.chat.service import ChatService
from book_reader.chat.types import AskCallbacks, AskOptions, ProviderConfig
from book_reader.library.scan import Library
from book_reader.notes.store import NotepadStore
from book_reader.reading.pdf import PdfCache
from book_reader.reading.sections import SectionIndex
from book_reader.search.service import Searcher


def build_chat(library: Path, tmp_path: Path) -> ChatService:
    state = tmp_path / "state"
    pdf = PdfCache()
    sections = SectionIndex(state)
    catalogue = Library(library)
    searcher = Searcher(catalogue, pdf, sections, None, "local")
    providers = [ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")]
    return ChatService(catalogue, searcher, pdf, sections, NotepadStore(state), providers=providers)


@pytest.mark.parametrize(
    ("question", "labels", "visual", "must_have", "must_not"),
    [
        ("Compare sagas and two-phase commit.", ("Compare",), True, "read_section", "add_note"),
        (
            "What page defines the consistency model?",
            ("Locate",),
            False,
            "search_library",
            "add_note",
        ),
        ("Save this quote to my notes.", ("Notes",), False, "add_note", "get_book_outline"),
        (
            "Which books should I read on retrieval?",
            ("Survey library",),
            True,
            "list_books",
            "add_note",
        ),
        ("Explain how consistent hashing works.", ("Explain",), True, "read_document", "add_note"),
        ("Hello there.", (), False, "read_notes", "add_note"),
    ],
)
def test_guidance_matches_the_question_shape(
    question: str, labels: tuple[str, ...], visual: bool, must_have: str, must_not: str
) -> None:
    guidance = select_guidance(question)
    assert guidance.labels == labels
    assert guidance.visual is visual
    assert must_have in guidance.tools
    assert must_not not in guidance.tools


def test_no_match_keeps_every_read_tool() -> None:
    assert select_guidance("Hello there.").tools == READ_TOOLS


def test_tutor_overrides_the_question_shape() -> None:
    guidance = select_guidance("Compare sagas and two-phase commit.", socratic=True)
    assert guidance.labels == ("Socratic tutor",)
    assert "add_note" in guidance.tools


def test_at_most_two_shapes_are_applied() -> None:
    guidance = select_guidance("Compare the architecture of these two systems.")
    assert guidance.labels == ("Compare", "Map")


def test_locator_answers_skip_the_component_format(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    lookup = chat._system_prompt(None, None, question="What page defines the consistency model?")
    assert "ConceptCard" not in lookup
    assert "No visual block is needed" in lookup
    explain = chat._system_prompt(None, None, question="Explain how consistent hashing works.")
    assert "ConceptCard" in explain
    assert "No visual block is needed" not in explain


def test_tutor_prompt_still_carries_the_skill_map(library: Path, tmp_path: Path) -> None:
    chat = build_chat(library, tmp_path)
    prompt = chat._system_prompt(None, None, socratic=True, question="Teach me eigenvalues.")
    assert "SkillMap" in prompt
    assert "ONE question per turn" in prompt


def test_run_binds_only_the_tools_the_question_needs(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chat = build_chat(library, tmp_path)
    captured: dict[str, list[str]] = {}

    class FakeGraph:
        def invoke(self, state: dict[str, object], config: object = None) -> dict[str, object]:
            return {"messages": [*state["messages"], AIMessage(content="ok")]}  # type: ignore[misc]

    def fake_graph(
        self: ChatService,
        _bound: object,
        _plain: object,
        tools: list[BaseTool],
        **_kwargs: object,
    ) -> FakeGraph:
        captured["tools"] = [tool.name for tool in tools]
        return FakeGraph()

    class FakeModel:
        def bind_tools(self, _tools: object) -> FakeModel:
            return self

        def invoke(self, _messages: object) -> AIMessage:
            return AIMessage(content="ok")

    monkeypatch.setattr(ChatService, "_graph", fake_graph)
    monkeypatch.setattr("book_reader.chat.service._chat_model", lambda *_a, **_k: FakeModel())
    provider = ProviderConfig(name="test", base_url="http://localhost", model="m", api_key="k")

    chat._run(
        provider,
        [{"role": "user", "content": "Save this quote to my notes."}],
        AskOptions(),
        AskCallbacks(),
    )

    expected = list(select_guidance("Save this quote to my notes.").tools)
    assert captured["tools"] == expected
    assert "add_note" in captured["tools"]
    assert "get_book_outline" not in captured["tools"]
