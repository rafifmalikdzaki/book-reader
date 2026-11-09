"""Eval cases, per-response evaluation and the suite runner."""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from ..chat_types import AskOptions, ChatBackend, ChatMessage
from ..library.scan import Library
from .openui import extract_openui_blocks, openui_program_errors, validate_openui_spec
from .scoring import score_citations, score_pedagogy


@dataclass(frozen=True)
class EvalCase:
    """Single evaluation scenario for the Ask research and teaching agent."""

    id: str
    title: str
    prompt: str
    mode: str = "teacher"
    book: str | None = None
    page: int | None = None
    expected_components: tuple[str, ...] = ()
    require_citations: bool = True


@dataclass
class EvalResult:
    """Scored outcome of running one EvalCase."""

    case_id: str
    title: str
    mode: str
    provider: str
    model: str
    latency_ms: float
    openui_components: list[str] = field(default_factory=list)
    openui_valid: bool = False
    openui_score: float = 0.0
    citation_count: int = 0
    citation_score: float = 0.0
    pedagogy_score: float = 0.0
    overall_score: float = 0.0
    notes: list[str] = field(default_factory=list)


def evaluate_response(
    case: EvalCase,
    response: dict[str, Any],
    *,
    latency_ms: float = 0.0,
    library: Library | None = None,
) -> EvalResult:
    """Evaluate a single `ChatService.ask` response dictionary against an `EvalCase`."""
    answer = str(response.get("answer") or "")
    sources = list(response.get("sources") or [])
    provider = str(response.get("provider") or "unknown")
    model = str(response.get("model") or "unknown")

    specs = extract_openui_blocks(answer)
    components = [str(s.get("component")) for s in specs]
    validations = [validate_openui_spec(s) for s in specs]
    program_errors = openui_program_errors(answer)
    all_valid = bool(validations) and all(ok for ok, _ in validations) and not program_errors

    openui_score = 0.0
    notes: list[str] = []
    if specs:
        valid_count = sum(1 for ok, _ in validations if ok)
        openui_score = 0.6 * (valid_count / len(specs))
        if program_errors:
            openui_score *= 0.5
            notes.append(f"OpenUI Lang errors: {'; '.join(program_errors[:3])}")
        if not case.expected_components or any(c in case.expected_components for c in components):
            openui_score += 0.4
            notes.append(f"matched expected OpenUI ({', '.join(components)})")
        else:
            notes.append(
                f"used {', '.join(components)} (expected {'/'.join(case.expected_components)})"
            )
    elif program_errors:
        notes.append(f"OpenUI Lang errors: {'; '.join(program_errors[:3])}")
    elif not case.expected_components:
        openui_score = 1.0
    else:
        notes.append(f"missing expected OpenUI ({'/'.join(case.expected_components)})")

    cite_count, cite_score = score_citations(answer, sources, library=library)
    if not case.require_citations:
        cite_score = max(cite_score, 1.0)

    ped_score, ped_notes = score_pedagogy(answer, case.mode, specs)
    notes.extend(ped_notes)

    overall = round(0.40 * openui_score + 0.25 * cite_score + 0.35 * ped_score, 2)
    return EvalResult(
        case_id=case.id,
        title=case.title,
        mode=case.mode,
        provider=provider,
        model=model,
        latency_ms=round(latency_ms, 1),
        openui_components=components,
        openui_valid=all_valid,
        openui_score=round(openui_score, 2),
        citation_count=cite_count,
        citation_score=round(cite_score, 2),
        pedagogy_score=ped_score,
        overall_score=overall,
        notes=notes,
    )


DEFAULT_EVAL_SUITE: tuple[EvalCase, ...] = (
    EvalCase(
        id="concept_card",
        title="Concept Explanation (ConceptCard)",
        prompt=(
            "Explain scaled dot-product attention with intuition, formal math, "
            "and a ConceptCard OpenUI block."
        ),
        mode="teacher",
        expected_components=("ConceptCard",),
        require_citations=False,
    ),
    EvalCase(
        id="comparison_table",
        title="Trade-off Analysis (ComparisonTable)",
        prompt=(
            "Compare self-attention vs recurrent neural networks (RNNs) across complexity, "
            "parallelism, and long-range dependencies using a ComparisonTable OpenUI block."
        ),
        mode="teacher",
        expected_components=("ComparisonTable",),
        require_citations=False,
    ),
    EvalCase(
        id="step_walkthrough",
        title="Guided Derivation (StepWalkthrough)",
        prompt=(
            "Walk me step-by-step through how gradient descent updates weights using "
            "the chain rule, including a StepWalkthrough OpenUI block."
        ),
        mode="teacher",
        expected_components=("StepWalkthrough",),
        require_citations=False,
    ),
    EvalCase(
        id="concept_graph",
        title="Architecture Diagram (ConceptGraph)",
        prompt=(
            "Map the core components of a Transformer block and how information flows "
            "between them using a ConceptGraph OpenUI block."
        ),
        mode="teacher",
        expected_components=("ConceptGraph",),
        require_citations=False,
    ),
    EvalCase(
        id="book_discovery",
        title="Library Survey (BookList)",
        prompt=(
            "Recommend books from my library for mastering deep learning and neural networks, "
            "and include a BookList OpenUI block."
        ),
        mode="teacher",
        expected_components=("BookList",),
        require_citations=True,
    ),
    EvalCase(
        id="socratic_tutor",
        title="Socratic Diagnostic (SkillMap + QuizCheck)",
        prompt="Tutor me Socratically on backpropagation. Start with a SkillMap and one question.",
        mode="tutor",
        expected_components=("SkillMap", "QuizCheck"),
        require_citations=False,
    ),
)


def run_eval_suite(
    chat: ChatBackend,
    cases: Sequence[EvalCase] = DEFAULT_EVAL_SUITE,
    *,
    model: str | None = None,
    library: Library | None = None,
) -> list[EvalResult]:
    """Run all evaluation cases against `chat` and return scored `EvalResult` records."""
    results: list[EvalResult] = []
    for case in cases:
        messages: list[ChatMessage] = [{"role": "user", "content": case.prompt}]
        t0 = time.perf_counter()
        response = chat.ask(
            messages,
            AskOptions(book=case.book, page=case.page, model=model, mode=case.mode),
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        results.append(
            evaluate_response(
                case,
                response,
                latency_ms=elapsed_ms,
                library=library,
            )
        )
    return results
