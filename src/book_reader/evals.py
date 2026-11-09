"""Evaluation suite for Ask RAG, Socratic Tutor, and OpenUI generative blocks."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .chat import ChatMessage, ChatService
from .library import Library

_FENCE_RE = re.compile(
    r"```(?P<lang>openui|ui|json|)\s*\n(?P<body>.*?)\n```",
    re.DOTALL | re.IGNORECASE,
)
_INLINE_CITE_RE = re.compile(r"(?<![\\/\w])([\w./-]+\.(?:pdf|md))(?:#(?:p(\d+)|L(\d+)))?\b")
# String literals are matched first so ", ]" inside text is left alone.
_TRAILING_COMMA_RE = re.compile(r'("(?:[^"\\]|\\.)*")|,(\s*[}\]])')
_LATEX_WORD_ESCAPE_RE = re.compile(
    r"(?<!\\)\\(?=(?:frac|forall|flat|beta|binom|big|bar|bf|theta|tau|times|top|text|tilde|to|nabla|neq|nu|norm|not|rho|rightarrow|right)\b)"
)
_UNESCAPED_SLASH_RE = re.compile(r'(?<!\\)\\(?![/\\"\'bfnrtu])')

VALID_COMPONENTS = frozenset(
    {
        "SkillMap",
        "ConceptCard",
        "ComparisonTable",
        "StepWalkthrough",
        "BookList",
        "QuizCheck",
        "ConceptGraph",
        "Graph",
        "Architecture",
        "Chart",
        "BarChart",
        "MetricChart",
    }
)

CANONICAL_COMPONENT: dict[str, str] = {
    "SkillMap": "SkillMap",
    "ConceptCard": "ConceptCard",
    "ComparisonTable": "ComparisonTable",
    "StepWalkthrough": "StepWalkthrough",
    "BookList": "BookList",
    "QuizCheck": "QuizCheck",
    "ConceptGraph": "ConceptGraph",
    "Graph": "ConceptGraph",
    "Architecture": "ConceptGraph",
    "Chart": "Chart",
    "BarChart": "Chart",
    "MetricChart": "Chart",
}


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


def extract_openui_blocks(text: str) -> list[dict[str, Any]]:
    """Extract and parse all OpenUI JSON specs from an assistant answer."""
    specs: list[dict[str, Any]] = []
    for match in _FENCE_RE.finditer(text or ""):
        lang = (match.group("lang") or "").strip().lower()
        body = (match.group("body") or "").strip()
        if not body:
            continue
        if lang in ("json", "") and '"component"' not in body:
            continue
        parsed = _parse_json_lenient(body)
        if isinstance(parsed, dict):
            comp = str(parsed.get("component") or "").strip()
            if comp in VALID_COMPONENTS:
                normalized = dict(parsed)
                normalized["component"] = CANONICAL_COMPONENT[comp]
                specs.append(normalized)
    return specs


def _parse_json_lenient(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        cleaned = _TRAILING_COMMA_RE.sub(lambda m: m.group(1) or m.group(2), raw)
        cleaned = _LATEX_WORD_ESCAPE_RE.sub(r"\\\\", cleaned)
        cleaned = _UNESCAPED_SLASH_RE.sub(r"\\\\", cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return None


def validate_openui_spec(spec: dict[str, Any]) -> tuple[bool, str]:
    """Validate required fields of a parsed OpenUI component spec."""
    comp = str(spec.get("component") or "")
    if comp == "ConceptCard":
        title = str(spec.get("title") or spec.get("name") or "").strip()
        filled = sum(
            1
            for k in (
                "intuition",
                "summary",
                "formal",
                "math",
                "equation",
                "definition",
                "example",
                "worked_example",
                "takeaways",
                "key_takeaways",
                "points",
            )
            if spec.get(k)
        )
        if title and filled >= 2:
            return True, "valid ConceptCard"
        return False, "ConceptCard missing title or body sections"

    if comp == "ComparisonTable":
        cols = spec.get("columns") or spec.get("headers")
        rows = spec.get("rows")
        if isinstance(cols, list) and len(cols) >= 2 and isinstance(rows, list) and len(rows) >= 1:
            return True, "valid ComparisonTable"
        return False, "ComparisonTable requires >=2 columns and >=1 row"

    if comp == "StepWalkthrough":
        steps = spec.get("steps") or spec.get("items")
        if isinstance(steps, list) and len(steps) >= 2:
            return True, f"valid StepWalkthrough ({len(steps)} steps)"
        return False, "StepWalkthrough requires >=2 steps"

    if comp == "ConceptGraph":
        nodes = spec.get("nodes")
        edges = spec.get("edges") or spec.get("links")
        if (
            isinstance(nodes, list)
            and len(nodes) >= 2
            and isinstance(edges, list)
            and len(edges) >= 1
        ):
            return True, f"valid ConceptGraph ({len(nodes)} nodes, {len(edges)} edges)"
        return False, "ConceptGraph requires >=2 nodes and >=1 edge"

    if comp == "Chart":
        items = spec.get("items") or spec.get("bars") or spec.get("data")
        if isinstance(items, list) and len(items) >= 2:
            return True, f"valid Chart ({len(items)} items)"
        return False, "Chart requires >=2 items"

    if comp == "BookList":
        books = spec.get("books") or spec.get("items")
        if isinstance(books, list) and len(books) >= 1:
            return True, f"valid BookList ({len(books)} books)"
        return False, "BookList requires >=1 book entry"

    if comp == "SkillMap":
        skills = spec.get("skills") or spec.get("items")
        if isinstance(skills, list) and len(skills) >= 2:
            levels_ok = all(
                isinstance(s, dict) and 0 <= int(s.get("level", 0)) <= 5 for s in skills
            )
            if levels_ok:
                return True, f"valid SkillMap ({len(skills)} subskills)"
        return False, "SkillMap requires >=2 skills with levels 0..5"

    if comp == "QuizCheck":
        if str(spec.get("question") or "").strip():
            return True, "valid QuizCheck"
        return False, "QuizCheck requires question"

    return False, f"unknown component: {comp}"


def score_citations(
    answer: str,
    sources: Sequence[dict[str, Any]],
    library: Library | None = None,
) -> tuple[int, float]:
    """Count and score inline + tool citations, checking existence in library when provided."""
    inline_matches = _INLINE_CITE_RE.findall(answer or "")
    cited_books: set[str] = {m[0] for m in inline_matches if m[0]}
    for src in sources or []:
        book = str(src.get("book") or "").strip()
        if book:
            cited_books.add(book)
    for block in extract_openui_blocks(answer or ""):
        if block.get("book"):
            cited_books.add(str(block["book"]).split("#")[0])
        for b in block.get("books") or []:
            if isinstance(b, dict) and b.get("book"):
                cited_books.add(str(b["book"]).split("#")[0])

    total = len(cited_books) + len(inline_matches)
    if total == 0:
        return 0, 0.0

    if library is None:
        return len(cited_books), 1.0

    known_paths = {b.rel for b in library.scan()}
    valid_books = 0
    for rel in cited_books:
        clean = rel.split("#")[0].strip()
        if library.find_book(clean) is not None or any(
            p == clean or p.endswith(f"/{clean}") for p in known_paths
        ):
            valid_books += 1
    if not cited_books:
        return 0, 0.0
    ratio = valid_books / len(cited_books)
    return len(cited_books), round(min(1.0, 0.5 + 0.5 * ratio), 2)


def score_pedagogy(
    answer: str, mode: str, specs: Sequence[dict[str, Any]]
) -> tuple[float, list[str]]:
    """Score pedagogical quality for Master Teacher ('teacher') or Socratic ('tutor') mode."""
    text = (answer or "").strip()
    if not text:
        return 0.0, ["empty response"]

    notes: list[str] = []
    score = 0.0
    comp_names = {str(s.get("component")) for s in specs}

    if mode == "tutor":
        # Socratic tutor rubric:
        # 1. Includes SkillMap or QuizCheck (0.4)
        if "SkillMap" in comp_names or "QuizCheck" in comp_names:
            score += 0.4
            notes.append("has Socratic OpenUI block")
        else:
            notes.append("missing SkillMap/QuizCheck")
        # 2. Asks a question (0.4)
        if "?" in text or "QuizCheck" in comp_names:
            score += 0.4
            notes.append("asks diagnostic/guiding question")
        else:
            notes.append("missing guiding question")
        # 3. Concise turn — avoids dumping a giant lecture (0.2)
        prose_without_fences = _FENCE_RE.sub("", text).strip()
        word_count = len(prose_without_fences.split())
        if word_count <= 350:
            score += 0.2
            notes.append(f"concise Socratic turn ({word_count} words)")
        else:
            notes.append(f"verbose turn ({word_count} words)")
        return round(score, 2), notes

    # Master Teacher rubric:
    # 1. Non-trivial structured explanation (0.4)
    prose_without_fences = _FENCE_RE.sub("", text).strip()
    words = len(prose_without_fences.split())
    if words >= 25 or (words >= 12 and comp_names):
        score += 0.4
        notes.append(f"structured prose ({words} words)")
    elif words >= 8:
        score += 0.2
        notes.append(f"brief prose ({words} words)")

    # 2. Rich formatting: headings, lists, math, or tables (0.3)
    has_structure = bool(
        re.search(r"(^#+\s|\*\*|\$.*\$|^[-*]\s|\|.+\|)", prose_without_fences, re.MULTILINE)
    )
    if has_structure:
        score += 0.3
        notes.append("uses rich Markdown/LaTeX")

    # 3. Valid OpenUI visual component (0.3)
    if comp_names:
        score += 0.3
        notes.append(f"includes {', '.join(sorted(comp_names))}")

    return round(min(1.0, score), 2), notes


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
    all_valid = bool(validations) and all(ok for ok, _ in validations)

    openui_score = 0.0
    notes: list[str] = []
    if specs:
        valid_count = sum(1 for ok, _ in validations if ok)
        openui_score = 0.6 * (valid_count / len(specs))
        if not case.expected_components or any(c in case.expected_components for c in components):
            openui_score += 0.4
            notes.append(f"matched expected OpenUI ({', '.join(components)})")
        else:
            notes.append(
                f"used {', '.join(components)} (expected {'/'.join(case.expected_components)})"
            )
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
    chat: ChatService,
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
            book=case.book,
            page=case.page,
            model=model,
            mode=case.mode,
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


class OfflineEvalModel:
    """Deterministic local stub that exercises tools and emits valid OpenUI blocks."""

    def bind_tools(self, tools: Any) -> OfflineEvalModel:
        return self

    def invoke(self, messages: list[Any]) -> Any:
        from langchain_core.messages import AIMessage

        prompt = str(messages[-1].content if messages else "").lower()
        if "socratically" in prompt or "skillmap" in prompt:
            body = (
                "Let's map your current mastery of **backpropagation** before diving in.\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "SkillMap",
                        "topic": "Backpropagation & Chain Rule",
                        "book": "sub/a.pdf#p1",
                        "focus": "Computational graph gradients",
                        "skills": [
                            {"name": "Forward pass activations", "level": 4, "status": "done"},
                            {
                                "name": "Computational graph gradients",
                                "level": 2,
                                "status": "focus",
                                "note": "Local derivative * upstream gradient",
                            },
                            {"name": "Jacobian-vector products", "level": 1, "status": "review"},
                        ],
                    }
                )
                + "\n```\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "QuizCheck",
                        "question": "If y = f(g(x)), how does dy/dx relate to dy/dg and dg/dx?",
                        "hint": "Recall the single-variable chain rule.",
                        "options": ["dy/dg * dg/dx", "dy/dg + dg/dx", "dy/dg / dg/dx"],
                    }
                )
                + "\n```\n\n"
                "How would you express $\\frac{\\partial L}{\\partial x}$ using the chain rule?"
            )
            return AIMessage(content=body)

        if "comparisontable" in prompt or "compare" in prompt:
            body = (
                "## Self-Attention vs. Recurrent Neural Networks\n\n"
                "Self-attention connects all token positions in $O(1)$ sequential steps "
                "(see `sub/a.pdf#p1`), whereas RNNs process tokens in $O(n)$ steps.\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "ComparisonTable",
                        "title": "Self-Attention vs. RNNs",
                        "columns": ["Dimension", "Self-Attention", "Recurrent (RNN)"],
                        "rows": [
                            ["Sequential operations", "O(1)", "O(n)"],
                            ["Complexity per layer", "O(n^2 * d)", "O(n * d^2)"],
                            ["Max path length", "O(1)", "O(n)"],
                        ],
                        "verdict": "Use Self-Attention for parallel training and long context.",
                    }
                )
                + "\n```"
            )
            return AIMessage(content=body)

        if "stepwalkthrough" in prompt or "step-by-step" in prompt:
            body = (
                "## Gradient Descent Weight Update Walkthrough\n\n"
                "Gradient descent updates parameters $\\theta$ opposite the loss gradient "
                "$\\nabla_\\theta \\mathcal{L}$ (`sub/a.pdf#p1`).\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "StepWalkthrough",
                        "title": "Backpropagation & Gradient Step",
                        "steps": [
                            {
                                "title": "Compute forward loss",
                                "detail": "Evaluate predictions and scalar loss L(y, y_hat).",
                                "formula": "\\mathcal{L}(\\hat{y}, y)",
                                "cite": "sub/a.pdf#p1",
                            },
                            {
                                "title": "Backpropagate local gradients",
                                "detail": "Apply the chain rule backward through each layer.",
                                "formula": "\\nabla_W \\mathcal{L} = \\delta \\cdot h^\\top",
                                "cite": "sub/a.pdf#p1",
                            },
                            {
                                "title": "Update parameters",
                                "detail": "Step opposite the gradient with learning rate eta.",
                                "formula": "W \\leftarrow W - \\eta \\nabla_W \\mathcal{L}",
                                "cite": "sub/a.pdf#p1",
                            },
                        ],
                    }
                )
                + "\n```"
            )
            return AIMessage(content=body)

        if "conceptgraph" in prompt or "map the core" in prompt:
            body = (
                "## Transformer Block Information Flow\n\n"
                "Tokens flow through multi-head attention, residual layer norm, and the "
                "position-wise feed-forward network (`sub/a.pdf#p1`).\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "ConceptGraph",
                        "title": "Transformer Block Architecture",
                        "subtitle": "Residual stream & sub-layers",
                        "book": "sub/a.pdf#p1",
                        "nodes": [
                            {
                                "id": "emb",
                                "label": "Token Embeddings",
                                "group": "input",
                                "detail": "Input vectors X + positional encoding",
                            },
                            {
                                "id": "mha",
                                "label": "Multi-Head Attention",
                                "group": "core",
                                "detail": "Parallel scaled dot-product heads",
                            },
                            {
                                "id": "ffn",
                                "label": "Feed-Forward MLP",
                                "group": "core",
                                "detail": "Position-wise non-linear projection",
                            },
                            {
                                "id": "out",
                                "label": "Contextual Representations",
                                "group": "output",
                                "detail": "Layer-normalized output states",
                            },
                        ],
                        "edges": [
                            {"from": "emb", "to": "mha", "label": "Q, K, V"},
                            {"from": "mha", "to": "ffn", "label": "residual + norm"},
                            {"from": "ffn", "to": "out", "label": "residual + norm"},
                        ],
                    }
                )
                + "\n```"
            )
            return AIMessage(content=body)

        if "booklist" in prompt or "recommend books" in prompt:
            body = (
                "## Recommended Deep Learning Books\n\n"
                "Here are the best starting volumes in your library (`sub/a.pdf#p1`).\n\n"
                "```openui\n"
                + json.dumps(
                    {
                        "component": "BookList",
                        "title": "Core Deep Learning Path",
                        "books": [
                            {
                                "book": "sub/a.pdf",
                                "title": "Foundations of Deep Learning",
                                "category": "Deep Learning",
                                "why": "Covers attention, optimization, and backprop.",
                                "start": "Chapter 1 (p.1)",
                            }
                        ],
                    }
                )
                + "\n```"
            )
            return AIMessage(content=body)

        body = (
            "## Scaled Dot-Product Attention\n\n"
            "Intuitively, attention computes a soft dictionary lookup where queries $Q$ match "
            "keys $K$ to weight values $V$ (`sub/a.pdf#p1`). Formally:\n\n"
            "$$\\mathrm{Attention}(Q, K, V) = "
            "\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$\n\n"
            "```openui\n"
            + json.dumps(
                {
                    "component": "ConceptCard",
                    "title": "Scaled Dot-Product Attention",
                    "subtitle": "Core Transformer Mechanism",
                    "book": "sub/a.pdf#p1",
                    "intuition": "Soft content-addressable lookup across all sequence tokens.",
                    "formal": "softmax(QK^T / sqrt(d_k))V scales dot products.",
                    "example": "A pronoun token attends strongly to its antecedent noun.",
                    "takeaways": [
                        "Scaling by 1/sqrt(d_k) keeps variance unit-scaled",
                        "All-pairs attention runs in parallel across tokens",
                    ],
                }
            )
            + "\n```"
        )
        return AIMessage(content=body)


def format_scorecard(results: Sequence[EvalResult]) -> str:
    """Format a list of `EvalResult` items into an ASCII benchmark table."""
    lines = [
        "=" * 98,
        f"{'CASE':<24} {'MODE':<8} {'MODEL':<22} {'OPENUI':<8} "
        f"{'CITE':<6} {'PEDAGOGY':<9} {'OVERALL':<8} {'LATENCY'}",
        "-" * 98,
    ]
    for r in results:
        model_label = f"{r.provider}:{r.model}"[:21]
        lines.append(
            f"{r.case_id:<24} {r.mode:<8} {model_label:<22} "
            f"{r.openui_score:<8.2f} {r.citation_score:<6.2f} "
            f"{r.pedagogy_score:<9.2f} {r.overall_score:<8.2f} {r.latency_ms:>6.0f} ms"
        )
    lines.append("-" * 98)
    if results:
        avg_openui = sum(r.openui_score for r in results) / len(results)
        avg_cite = sum(r.citation_score for r in results) / len(results)
        avg_ped = sum(r.pedagogy_score for r in results) / len(results)
        avg_total = sum(r.overall_score for r in results) / len(results)
        avg_lat = sum(r.latency_ms for r in results) / len(results)
        lines.append(
            f"{'AVERAGE':<24} {'all':<8} {'-':<22} "
            f"{avg_openui:<8.2f} {avg_cite:<6.2f} "
            f"{avg_ped:<9.2f} {avg_total:<8.2f} {avg_lat:>6.0f} ms"
        )
    lines.append("=" * 98)
    return "\n".join(lines)
