"""Benchmark and capability evaluation runner for Ask + Socratic Tutor + OpenUI."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

import book_reader.chat.model as chat_mod
from book_reader.chat import ChatService, ProviderConfig, openui_format
from book_reader.evals import (
    DEFAULT_EVAL_SUITE,
    OfflineEvalModel,
    format_scorecard,
    run_eval_suite,
)
from book_reader.library.scan import Library
from book_reader.notes.store import NotepadStore
from book_reader.organize import CategoryStore
from book_reader.reading.pages import PageIndex
from book_reader.reading.pdf import PdfCache
from book_reader.reading.sections import SectionIndex
from book_reader.search.service import Searcher


class _AnswerRecorder:
    """Wraps a chat backend and keeps every answer so it can be replayed in the frontend."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.records: list[dict[str, Any]] = []

    def ask(self, messages: Any, options: Any = None, callbacks: Any = None) -> Any:
        response = self._inner.ask(messages, options, callbacks)
        self.records.append(
            {
                "case": messages[-1]["content"][:60],
                "provider": response.get("provider"),
                "model": response.get("model"),
                "answer": response.get("answer"),
            }
        )
        return response


def _populate_benchmark_library(lib_dir: Path, *, include_stub_pdf: bool = False) -> None:
    """Create a fast, self-contained benchmark library for deterministic & live LLM evals."""
    dl_dir = lib_dir / "deep_learning"
    dl_dir.mkdir(parents=True, exist_ok=True)
    if include_stub_pdf:
        (lib_dir / "sub").mkdir(parents=True, exist_ok=True)
        (lib_dir / "sub" / "a.pdf").write_bytes(b"%PDF-1.4 stub")

    (dl_dir / "transformers_and_attention.md").write_text(
        "# Foundations of Transformers and Attention\n\n"
        "## Chapter 1: Scaled Dot-Product Attention\n\n"
        "Scaled dot-product attention computes a weighted sum of values $V$ where the weights "
        "are determined by the compatibility of queries $Q$ and keys $K$ of dimension $d_k$:\n\n"
        "$$\\mathrm{Attention}(Q, K, V) = "
        "\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$\n\n"
        "Scaling by $1/\\sqrt{d_k}$ prevents large dot products from pushing the softmax into "
        "regions with vanishingly small gradients.\n\n"
        "## Chapter 2: Self-Attention vs. Recurrent Neural Networks\n\n"
        "- **Self-Attention**: $O(1)$ sequential steps, $O(n^2 \\cdot d)$ complexity per layer, "
        "and $O(1)$ maximum path length between any two token positions.\n"
        "- **Recurrent Neural Networks (RNNs)**: $O(n)$ sequential operations, $O(n \\cdot d^2)$ "
        "complexity per layer, and $O(n)$ path length for long-range dependencies.\n\n"
        "## Chapter 3: Transformer Block Architecture\n\n"
        "A Transformer block maps input token embeddings through (1) Multi-Head Self-Attention, "
        "(2) Residual connection and Layer Normalization, (3) Position-wise Feed-Forward MLP, and "
        "(4) Output Residual connection and Layer Normalization.\n",
        encoding="utf-8",
    )

    (dl_dir / "backpropagation_and_optimization.md").write_text(
        "# Deep Learning Optimization & Backpropagation\n\n"
        "## Chapter 1: Chain Rule and Computational Graphs\n\n"
        "Backpropagation computes the gradient of a scalar loss $\\mathcal{L}(\\hat{y}, y)$ "
        "with respect to weights $W$ by applying the chain rule backward through the graph:\n\n"
        "1. **Forward pass**: Compute activations $h_l = \\sigma(W_l h_{l-1} + b_l)$ "
        "and scalar loss $\\mathcal{L}$.\n"
        "2. **Backward pass**: Propagate upstream gradient "
        "$\\delta_l = \\frac{\\partial \\mathcal{L}}{\\partial z_l}$ "
        "and compute parameter gradients $\\nabla_{W_l} \\mathcal{L} = \\delta_l h_{l-1}^\\top$.\n"
        "3. **Gradient descent step**: "
        "Update $W_l \\leftarrow W_l - \\eta \\nabla_{W_l} \\mathcal{L}$.\n",
        encoding="utf-8",
    )


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Run Ask + OpenUI evaluation suite.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Run against the live configured LLM provider (defaults to inception:mercury-3).",
    )
    parser.add_argument(
        "--model",
        default="inception:mercury-3",
        help="Model id for --live evaluation (default: inception:mercury-3).",
    )
    parser.add_argument(
        "--library",
        default="",
        help="Optional library directory override for --live evaluation.",
    )
    parser.add_argument(
        "--save-answers",
        default="",
        help="Write the --live answers to this JSON file (replay: see OPENUI_REPLAY in the "
        "frontend replay test).",
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if args.library:
            lib_dir = Path(args.library).expanduser().resolve()
        else:
            lib_dir = root / "books"
            _populate_benchmark_library(lib_dir, include_stub_pdf=not args.live)

        state = root / "state"
        pdf = PdfCache()
        sections = SectionIndex(state)
        notepad = NotepadStore(state)
        pages = PageIndex(state, pdf)
        categories = CategoryStore(state)
        catalogue = Library(lib_dir)
        searcher = Searcher(catalogue, pdf, sections, None, "local")

        if args.live:
            chat = ChatService(
                catalogue,
                searcher,
                pdf,
                sections,
                notepad,
                pages=pages,
                categories=categories,
            )
            recorder = _AnswerRecorder(chat)
            results = run_eval_suite(
                recorder, DEFAULT_EVAL_SUITE, model=args.model, library=catalogue
            )
            if args.save_answers:
                Path(args.save_answers).write_text(json.dumps(recorder.records, indent=1))
            print("\n" + format_scorecard(results) + "\n")
            for r in results:
                print(f"  • {r.case_id}: {', '.join(r.notes)}")
            return 0

        providers = [
            ProviderConfig(
                name="inception",
                base_url="http://localhost",
                model="mercury-3",
                api_key="stub",
            )
        ]
        chat = ChatService(
            catalogue,
            searcher,
            pdf,
            sections,
            notepad,
            pages=pages,
            categories=categories,
            providers=providers,
        )
        orig_chat_openai = chat_mod.ChatOpenAI
        chat_mod.ChatOpenAI = lambda **_kw: OfflineEvalModel(openui_format())  # type: ignore[misc,assignment]
        try:
            results = run_eval_suite(chat, DEFAULT_EVAL_SUITE, library=catalogue)
        finally:
            chat_mod.ChatOpenAI = orig_chat_openai  # type: ignore[misc,assignment]
        print("\n" + format_scorecard(results) + "\n")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
