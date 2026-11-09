"""Deterministic stand-in model so the suite runs without network access."""

from __future__ import annotations

import json
from typing import Any, Literal

from .openui_lang import serialize_openui_lang


class OfflineEvalModel:
    """Deterministic local stub that exercises tools and emits valid OpenUI blocks.

    ``answer_format`` is ``"lang"`` (OpenUI Lang) or ``"json"`` (the legacy block format).
    """

    def __init__(self, answer_format: Literal["lang", "json"] = "lang") -> None:
        self.answer_format = answer_format

    def _block(self, spec: dict[str, Any]) -> str:
        if self.answer_format == "json":
            return "```openui\n" + json.dumps(spec) + "\n```"
        return "```openui-lang\n" + serialize_openui_lang([spec]) + "\n```"

    def bind_tools(self, tools: Any) -> OfflineEvalModel:
        return self

    def invoke(self, messages: list[Any]) -> Any:
        from langchain_core.messages import AIMessage

        prompt = str(messages[-1].content if messages else "").lower()
        if "socratically" in prompt or "skillmap" in prompt:
            body = (
                "Let's map your current mastery of **backpropagation** before diving in.\n\n"
                + self._block(
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
                + "\n\n"
                + self._block(
                    {
                        "component": "QuizCheck",
                        "question": "If y = f(g(x)), how does dy/dx relate to dy/dg and dg/dx?",
                        "hint": "Recall the single-variable chain rule.",
                        "options": ["dy/dg * dg/dx", "dy/dg + dg/dx", "dy/dg / dg/dx"],
                    }
                )
                + "\n\n"
                "How would you express $\\frac{\\partial L}{\\partial x}$ using the chain rule?"
            )
            return AIMessage(content=body)

        if "comparisontable" in prompt or "compare" in prompt:
            body = (
                "## Self-Attention vs. Recurrent Neural Networks\n\n"
                "Self-attention connects all token positions in $O(1)$ sequential steps "
                "(see `sub/a.pdf#p1`), whereas RNNs process tokens in $O(n)$ steps.\n\n"
                + self._block(
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
            )
            return AIMessage(content=body)

        if "stepwalkthrough" in prompt or "step-by-step" in prompt:
            body = (
                "## Gradient Descent Weight Update Walkthrough\n\n"
                "Gradient descent updates parameters $\\theta$ opposite the loss gradient "
                "$\\nabla_\\theta \\mathcal{L}$ (`sub/a.pdf#p1`).\n\n"
                + self._block(
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
            )
            return AIMessage(content=body)

        if "conceptgraph" in prompt or "map the core" in prompt:
            body = (
                "## Transformer Block Information Flow\n\n"
                "Tokens flow through multi-head attention, residual layer norm, and the "
                "position-wise feed-forward network (`sub/a.pdf#p1`).\n\n"
                + self._block(
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
            )
            return AIMessage(content=body)

        if "booklist" in prompt or "recommend books" in prompt:
            body = (
                "## Recommended Deep Learning Books\n\n"
                "Here are the best starting volumes in your library (`sub/a.pdf#p1`).\n\n"
                + self._block(
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
            )
            return AIMessage(content=body)

        body = (
            "## Scaled Dot-Product Attention\n\n"
            "Intuitively, attention computes a soft dictionary lookup where queries $Q$ match "
            "keys $K$ to weight values $V$ (`sub/a.pdf#p1`). Formally:\n\n"
            "$$\\mathrm{Attention}(Q, K, V) = "
            "\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$\n\n"
            + self._block(
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
        )
        return AIMessage(content=body)
