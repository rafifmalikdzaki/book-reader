"""Extraction and validation of OpenUI component blocks in assistant answers."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(
    r"```(?P<lang>openui|ui|json|)\s*\n(?P<body>.*?)\n```",
    re.DOTALL | re.IGNORECASE,
)

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
