"""Tests for the Ask + Socratic Tutor + OpenUI evaluation suite and Mercury 3 priority."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import book_reader.chat.model as chat_model_mod
from book_reader.chat.providers import resolve_providers
from book_reader.chat.service import ChatService
from book_reader.chat.types import ProviderConfig
from book_reader.evals import (
    DEFAULT_EVAL_SUITE,
    EvalCase,
    evaluate_response,
    extract_openui_blocks,
    run_eval_suite,
    score_citations,
    score_pedagogy,
    validate_openui_spec,
)
from book_reader.library.scan import Library
from book_reader.notes.store import NotepadStore
from book_reader.reading.pdf import PdfCache
from book_reader.reading.sections import SectionIndex
from book_reader.search.service import Searcher


def test_mercury_3_is_primary_default_provider() -> None:
    env = {
        "INCEPTION_API_KEY": "inc-key",
        "MISTRAL_API_KEY": "mis-key",
        "OPENROUTER_API_KEY": "or-key",
        "OLLAMA_API_KEY": "ol-key",
    }
    providers = resolve_providers(env)
    assert providers[0].name == "inception"
    assert providers[0].model == "mercury-3"


def test_extract_and_validate_all_openui_components() -> None:
    sample = "\n\n".join(
        [
            "```openui\n"
            + json.dumps(
                {
                    "component": "ConceptCard",
                    "title": "Attention",
                    "intuition": "Soft lookup",
                    "formal": "softmax(QK^T/sqrt(d))V",
                }
            )
            + "\n```",
            "```json\n"
            '{"component": "ConceptGraph", "title": "Flow", "nodes": ['
            '{"id": "a", "label": "A"}, {"id": "b", "label": "B"}'
            '], "edges": [{"from": "a", "to": "b"}],}\n'
            "```",
            "```openui\n"
            + json.dumps(
                {
                    "component": "Chart",
                    "title": "Speed",
                    "items": [
                        {"label": "Mercury 3", "value": 100},
                        {"label": "Other", "value": 40},
                    ],
                }
            )
            + "\n```",
        ]
    )
    specs = extract_openui_blocks(sample)
    assert [s["component"] for s in specs] == ["ConceptCard", "ConceptGraph", "Chart"]
    for spec in specs:
        ok, reason = validate_openui_spec(spec)
        assert ok, reason


def test_score_citations_grounds_against_library(library: Path) -> None:
    catalogue = Library(library)
    answer = "As shown in sub/a.pdf#p1, this concept is foundational."
    count, score = score_citations(answer, [{"book": "sub/a.pdf", "page": 1}], library=catalogue)
    assert count == 1
    assert score == 1.0


def test_score_pedagogy_distinguishes_teacher_and_tutor_modes() -> None:
    tutor_answer = (
        "Let's check your intuition first.\n\n"
        "```openui\n"
        + json.dumps(
            {
                "component": "SkillMap",
                "topic": "Backprop",
                "skills": [
                    {"name": "Chain rule", "level": 3, "status": "focus"},
                    {"name": "Jacobians", "level": 1},
                ],
            }
        )
        + "\n```\n\n"
        "What happens to the gradient when two functions are composed?"
    )
    specs = extract_openui_blocks(tutor_answer)
    tutor_score, _ = score_pedagogy(tutor_answer, "tutor", specs)
    assert tutor_score == 1.0

    case = EvalCase(
        id="socratic_check",
        title="Socratic Check",
        prompt="Tutor me on backprop",
        mode="tutor",
        expected_components=("SkillMap",),
        require_citations=False,
    )
    result = evaluate_response(
        case,
        {
            "answer": tutor_answer,
            "sources": [],
            "provider": "inception",
            "model": "mercury-3",
        },
        latency_ms=120.0,
    )
    assert result.overall_score == 1.0
    assert result.openui_valid is True


@pytest.mark.parametrize("answer_format", ["lang", "json"])
def test_run_eval_suite_end_to_end(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, answer_format: str
) -> None:
    from book_reader.evals import OfflineEvalModel

    state = tmp_path / "state"
    pdf = PdfCache()
    sections = SectionIndex(state)
    notepad = NotepadStore(state)
    catalogue = Library(library)
    searcher = Searcher(catalogue, pdf, sections, None, "local")
    providers = [
        ProviderConfig(
            name="inception",
            base_url="http://localhost",
            model="mercury-3",
            api_key="k",
        )
    ]
    chat = ChatService(catalogue, searcher, pdf, sections, notepad, providers=providers)
    monkeypatch.setattr(chat_model_mod, "ChatOpenAI", lambda **_kw: OfflineEvalModel(answer_format))  # type: ignore[arg-type]

    results = run_eval_suite(chat, DEFAULT_EVAL_SUITE, library=catalogue)
    assert len(results) == len(DEFAULT_EVAL_SUITE)
    for res in results:
        assert res.provider == "inception"
        assert res.model == "mercury-3"
        assert res.openui_valid is True
        assert res.openui_score == 1.0
        assert res.pedagogy_score >= 0.9
        assert res.overall_score >= 0.85


def test_unsound_openui_lang_program_is_scored_down() -> None:
    case = EvalCase(
        id="card",
        title="Card",
        prompt="Explain attention",
        expected_components=("ConceptCard",),
        require_citations=False,
    )
    sound = "Intro text for the card.\n\n```openui-lang\nroot = Answer([c])\nc = ConceptCard("
    good = evaluate_response(
        case,
        {"answer": sound + '"Attention", "Soft lookup", "softmax(QK)V")\n```'},
    )
    unreferenced = sound + '"Attention", "Soft lookup", "softmax(QK)V")\nx = Chart("T", [])\n```'
    bad = evaluate_response(case, {"answer": unreferenced})
    assert good.openui_valid is True
    assert bad.openui_valid is False
    assert bad.openui_score < good.openui_score
    assert any("never referenced" in note for note in bad.notes)
