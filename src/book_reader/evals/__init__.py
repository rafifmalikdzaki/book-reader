"""Evaluation suite for Ask RAG, Socratic Tutor, and OpenUI generative blocks.

Dev tooling: used by scripts/eval_ask.py and the tests, and excluded from the wheel.
"""

from __future__ import annotations

from .offline import OfflineEvalModel as OfflineEvalModel
from .openui import CANONICAL_COMPONENT as CANONICAL_COMPONENT
from .openui import VALID_COMPONENTS as VALID_COMPONENTS
from .openui import extract_openui_blocks as extract_openui_blocks
from .openui import validate_openui_spec as validate_openui_spec
from .report import format_scorecard as format_scorecard
from .scoring import score_citations as score_citations
from .scoring import score_pedagogy as score_pedagogy
from .suite import DEFAULT_EVAL_SUITE as DEFAULT_EVAL_SUITE
from .suite import EvalCase as EvalCase
from .suite import EvalResult as EvalResult
from .suite import evaluate_response as evaluate_response
from .suite import run_eval_suite as run_eval_suite
