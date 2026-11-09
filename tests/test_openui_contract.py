"""Keeps the three OpenUI definitions (prompt, Python validator, TS parser) in agreement."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

import book_reader.chat as chat_mod
from book_reader.evals import (
    CANONICAL_COMPONENT,
    VALID_COMPONENTS,
    extract_openui_blocks,
    validate_openui_spec,
)

OPENUI_TS = Path(__file__).resolve().parents[1] / "frontend/src/features/chat-render/openui.ts"
CANONICAL = set(CANONICAL_COMPONENT.values())


def _prompt_specs() -> list[dict[str, Any]]:
    # The prompt indents its fences for readability; the extractor expects them at column 0.
    text = "\n".join(line.lstrip() for line in chat_mod._OPENUI_INSTRUCTIONS.splitlines())
    return extract_openui_blocks(text)


def test_prompt_documents_every_component_with_parseable_examples() -> None:
    specs = _prompt_specs()
    assert {spec["component"] for spec in specs} == CANONICAL


def test_prompt_examples_pass_the_eval_validator() -> None:
    for spec in _prompt_specs():
        ok, reason = validate_openui_spec(spec)
        assert ok, f"{spec['component']} example in the system prompt fails validation: {reason}"


@pytest.mark.skipif(not OPENUI_TS.exists(), reason="frontend sources not present")
def test_python_and_typescript_accept_the_same_component_names() -> None:
    parser_source = OPENUI_TS.read_text()
    body = parser_source[parser_source.index("export function parseOpenUIBlock") :]
    ts_names = set(re.findall(r"case '(\w+)':", body))
    assert ts_names == set(VALID_COMPONENTS)


def test_trailing_comma_repair_leaves_string_contents_alone() -> None:
    raw = '```openui\n{"component": "QuizCheck", "question": "pairs, ] ok?",}\n```'
    [spec] = extract_openui_blocks(raw)
    assert spec["question"] == "pairs, ] ok?"
