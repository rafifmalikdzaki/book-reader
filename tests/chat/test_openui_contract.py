"""Keeps the OpenUI prompt, the generated spec and the Python checker in agreement.

The frontend component library is the source of truth. `npm run gen:openui-prompt` turns it into
the committed prompt and spec; the Vitest suite guards library -> prompt, and these tests guard
prompt -> Python (checker, system prompt, tutor skill).
"""

from __future__ import annotations

import re
from typing import Any

import pytest

import book_reader.chat.prompts as prompts
from book_reader.chat.registry import DEFAULT_OPENUI_FORMAT
from book_reader.evals import (
    extract_openui_blocks,
    openui_program_errors,
    parse_openui_lang,
    serialize_openui_lang,
    validate_openui_spec,
)
from book_reader.evals.openui_lang import SPEC_PATH, signatures

PROMPT_PATH = SPEC_PATH.with_name("openui_prompt.txt")
BLOCKS = set(signatures()) - {"Answer"}


def _prompt_examples() -> list[str]:
    text = PROMPT_PATH.read_text(encoding="utf-8")
    section = text.split("## Examples", 1)[1].split("\n## ", 1)[0]
    return [block.strip() for block in re.split(r"\n\s*\n", section) if block.strip()]


def test_prompt_documents_every_component_in_the_spec() -> None:
    text = PROMPT_PATH.read_text(encoding="utf-8")
    for name in signatures():
        assert f"\n{name}(" in text, f"{name} is missing from the generated prompt"


def test_prompt_examples_are_sound_programs_that_pass_the_validator() -> None:
    examples = _prompt_examples()
    assert examples
    for example in examples:
        program = parse_openui_lang(example)
        assert program.errors == [], example
        assert program.specs, example
        for spec in program.specs:
            ok, reason = validate_openui_spec(spec)
            assert ok, f"{spec['component']} example fails validation: {reason}"


def test_prompt_examples_cover_a_block_per_kind_of_question() -> None:
    covered = {
        spec["component"]
        for example in _prompt_examples()
        for spec in parse_openui_lang(example).specs
    }
    assert {"ConceptCard", "ConceptGraph", "Chart"} <= covered


@pytest.mark.parametrize("fmt", ["lang", "json"])
def test_tutor_skill_example_is_a_valid_skill_map(fmt: str) -> None:
    skill = prompts._socratic_skill_text(fmt)
    assert "{{SKILLMAP_EXAMPLE}}" not in skill
    [spec] = extract_openui_blocks(skill)
    assert spec["component"] == "SkillMap"
    assert validate_openui_spec(spec)[0]
    assert openui_program_errors(skill) == []


def test_system_prompt_uses_the_format_chosen_by_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOOK_READER_OPENUI_FORMAT", raising=False)
    assert prompts.openui_format() == DEFAULT_OPENUI_FORMAT
    monkeypatch.setenv("BOOK_READER_OPENUI_FORMAT", "json")
    assert prompts.openui_instructions() == prompts._OPENUI_JSON_INSTRUCTIONS
    monkeypatch.setenv("BOOK_READER_OPENUI_FORMAT", "lang")
    assert "openui-lang" in prompts.openui_instructions()
    monkeypatch.setenv("BOOK_READER_OPENUI_FORMAT", "nonsense")
    assert prompts.openui_format() == DEFAULT_OPENUI_FORMAT


def test_json_instructions_still_document_every_component_with_valid_examples() -> None:
    specs = extract_openui_blocks(
        "\n".join(line.lstrip() for line in prompts._OPENUI_JSON_INSTRUCTIONS.splitlines())
    )
    assert {spec["component"] for spec in specs} == BLOCKS
    for spec in specs:
        ok, reason = validate_openui_spec(spec)
        assert ok, f"{spec['component']} JSON example fails validation: {reason}"


def test_trailing_comma_repair_leaves_string_contents_alone() -> None:
    raw = '```openui\n{"component": "QuizCheck", "question": "pairs, ] ok?",}\n```'
    [spec] = extract_openui_blocks(raw)
    assert spec["question"] == "pairs, ] ok?"


class TestLangChecker:
    def test_maps_positional_arguments_to_field_names(self) -> None:
        program = parse_openui_lang(
            'root = Answer([c])\nc = ConceptCard("Attention", "Soft lookup", null, "Ex")'
        )
        assert program.errors == []
        assert program.specs == [
            {
                "component": "ConceptCard",
                "title": "Attention",
                "intuition": "Soft lookup",
                "example": "Ex",
            }
        ]

    def test_resolves_forward_references_and_nested_objects(self) -> None:
        program = parse_openui_lang(
            'root = Answer([chart])\nchart = Chart("T", items, "ms")\n'
            'items = [{label: "A", value: 1.5}, {label: "B", value: -2}]'
        )
        assert program.errors == []
        assert program.specs[0]["items"][1] == {"label": "B", "value": -2}

    def test_keeps_latex_backslashes_in_strings(self) -> None:
        program = parse_openui_lang(
            r"root = Answer([c])" + "\n" + r'c = ConceptCard("T", "$\frac{a}{b}$ \\ x")'
        )
        assert program.specs[0]["intuition"] == "$\\frac{a}{b}$ \\ x"

    @pytest.mark.parametrize(
        ("code", "message"),
        [
            ("", "missing root"),
            ('c = ConceptCard("T")', "missing root"),
            ('root = Answer([c])\nc = Nope("T")', "unknown component: Nope"),
            ("root = Answer([c])\nc = ConceptCard()", "needs at least 1"),
            ('root = Answer([c])\nc = QuizCheck("q", [], "h", 1)', "takes at most 3"),
            ("root = Answer([c])", "undefined name: c"),
            ('root = Answer([c])\nc = ConceptCard("T")\nd = Chart("x", [])', "never referenced"),
            ('root = ConceptCard("T")', "root must be Answer"),
            ('root = Answer([c])\nc = ConceptCard("T', "syntax error"),
            ("root = Answer([a])\na = Answer([a])", "circular"),
        ],
    )
    def test_reports_what_the_renderer_would_drop(self, code: str, message: str) -> None:
        program = parse_openui_lang(code)
        assert any(message in error for error in program.errors), program.errors

    def test_extraction_reports_program_errors_per_answer(self) -> None:
        answer = "Text\n\n```openui-lang\nroot = Answer([x])\nx = Nope(1)\n```\n"
        assert openui_program_errors(answer) == ["unknown component: Nope"]
        assert extract_openui_blocks(answer) == []

    def test_serializer_round_trips_through_the_parser(self) -> None:
        specs: list[dict[str, Any]] = [
            {"component": "ConceptCard", "title": 'Say "hi"', "formal": "a\\b", "book": "x.pdf#p1"},
            {"component": "Chart", "title": "T", "items": [{"label": "A", "value": 3}]},
            {"component": "QuizCheck", "question": "Why?"},
        ]
        program = parse_openui_lang(serialize_openui_lang(specs))
        assert program.errors == []
        assert program.specs == specs
