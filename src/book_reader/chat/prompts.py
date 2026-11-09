"""Prompt text and mode detection for the chat agent."""

from __future__ import annotations

import functools
import os
import re
from collections.abc import Sequence
from pathlib import Path

from .registry import DEFAULT_OPENUI_FORMAT, OPENUI_FORMATS, model_info
from .types import ChatMessage

_PACKAGE_DIR = Path(__file__).resolve().parent.parent
_SOCRATIC_SKILL_PATH = _PACKAGE_DIR / "skills" / "socratic_tutor.md"
# Generated from frontend/src/features/chat-render/openui/library.tsx by `just gen-prompt`.
_OPENUI_LANG_PROMPT_PATH = _PACKAGE_DIR / "prompts" / "openui_prompt.txt"

_SOCRATIC_TRIGGERS = re.compile(
    r"\b(?:"
    r"teach\s+me|tutor\s+me|quiz\s+me|drill\s+me|test\s+my\s+understanding|"
    r"help\s+me\s+master|socratic|show\s+progress|skill\s+map|just\s+tell\s+me|"
    r"save\s+state|resume\s+from\s*:"
    r")\b",
    re.IGNORECASE,
)

_OPENUI_JSON_INSTRUCTIONS = (
    "Formatting & Question-Adaptive UI (OpenUI):\n"
    "- Match your output structure to the user's question type. Always include a fenced "
    "```openui JSON block (valid JSON object, no comments or trailing commas) alongside clear "
    "Markdown and LaTeX ($...$ inline, $$...$$ display) when one of these components fits:\n"
    "  1. Concept / Section Explanation ('explain...', 'what is...', 'break down this section'):\n"
    "     ```openui\n"
    '     {"component":"ConceptCard","title":"...","subtitle":"...","book":"book.pdf#p12",'
    '"intuition":"Why this idea exists in plain language",'
    '"formal":"Core definition, equation, or mechanism",'
    '"example":"Concrete example from the text","takeaways":["Key point 1","Key point 2"]}\n'
    "     ```\n"
    "  2. Comparisons & Trade-offs ('compare...', 'A vs B', 'difference between...'):\n"
    "     ```openui\n"
    '     {"component":"ComparisonTable","title":"...",'
    '"columns":["Dimension","Option A","Option B"],'
    '"rows":[["Complexity","...","..."],["Use case","...","..."]],'
    '"verdict":"When to choose which"}\n'
    "     ```\n"
    "  3. Derivations / Algorithms / Step-by-Step Walkthroughs "
    "('derive...', 'walk me through...', 'how does algorithm X work'):\n"
    "     ```openui\n"
    '     {"component":"StepWalkthrough","title":"...","steps":[{"title":"Step 1","detail":"...",'
    '"formula":"...","cite":"book.pdf#p12"},{"title":"Step 2","detail":"..."}]}\n'
    "     ```\n"
    "  4. Architecture / Concept Relationships / Flows "
    "('map the architecture...', 'how do X, Y, Z connect', 'concept graph'):\n"
    "     ```openui\n"
    '     {"component":"ConceptGraph","title":"...","subtitle":"...","book":"book.pdf#p12",'
    '"nodes":[{"id":"n1","label":"Concept A","group":"input","detail":"...","cite":"book.pdf#p12"},'
    '{"id":"n2","label":"Concept B","group":"core","detail":"..."}],'
    '"edges":[{"from":"n1","to":"n2","label":"transforms into"}]}\n'
    "     ```\n"
    "  5. Quantitative Metrics / Benchmarks ('benchmark...', 'plot/chart...'):\n"
    "     ```openui\n"
    '     {"component":"Chart","title":"...","subtitle":"...","unit":"ms","book":"book.pdf#p18",'
    '"items":[{"label":"Method A","value":85,"displayValue":"85 ms","note":"O(n^2)"},'
    '{"label":"Method B","value":24,"displayValue":"24 ms","note":"O(n log n)"}],'
    '"caption":"Source context"}\n'
    "     ```\n"
    "  6. Book Recommendations / Library Survey ('recommend books...', 'which books cover...'):\n"
    "     ```openui\n"
    '     {"component":"BookList","title":"Recommended Reading",'
    '"books":[{"book":"path/to/book.pdf",'
    '"title":"Human Title","category":"Category","why":"Why this book fits",'
    '"start":"Section 2 (p.14)"}]}\n'
    "     ```\n"
    "  7. Socratic Tutoring / Mastery Tracking:\n"
    "     ```openui\n"
    '     {"component":"SkillMap","topic":"...","book":"book.pdf#p12","focus":"Current subskill",'
    '"skills":[{"name":"Subskill 1","level":3,"status":"focus","note":"..."},'
    '{"name":"Subskill 2","level":1}]}\n'
    "     ```\n"
    "     and for an interactive check question:\n"
    "     ```openui\n"
    '     {"component":"QuizCheck","question":"...","hint":"Optional nudge",'
    '"options":["Option A","Option B"]}\n'
    "     ```"
)


def openui_format(model_id: str | None = None) -> str:
    """Block format the model is asked to write.

    ``BOOK_READER_OPENUI_FORMAT`` (lang|json) overrides everything; otherwise the model's
    registry entry decides, and unknown models get the default.
    """
    value = os.environ.get("BOOK_READER_OPENUI_FORMAT", "").strip().lower()
    if value in OPENUI_FORMATS:
        return value
    return model_info(model_id).openui_format if model_id else DEFAULT_OPENUI_FORMAT


@functools.lru_cache(maxsize=1)
def _openui_lang_prompt() -> str:
    return _OPENUI_LANG_PROMPT_PATH.read_text(encoding="utf-8").strip()


def openui_instructions(fmt: str | None = None) -> str:
    """The component-format section of the system prompt for the active answer format."""
    return (
        _OPENUI_JSON_INSTRUCTIONS if (fmt or openui_format()) == "json" else _openui_lang_prompt()
    )


@functools.lru_cache(maxsize=2)
def _socratic_skill_template() -> str:
    try:
        return _SOCRATIC_SKILL_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return (
            "Act as a Socratic tutor: decompose the topic into 4-8 subskills (levels 0-5), "
            "run a short diagnostic one question at a time, render a SkillMap OpenUI block, "
            "and guide the user with one question per turn without lecturing.\n\n"
            "{{SKILLMAP_EXAMPLE}}"
        )


@functools.lru_cache(maxsize=2)
def _skillmap_example(fmt: str) -> str:
    suffix = "json" if fmt == "json" else "lang"
    return (_PACKAGE_DIR / "skills" / f"skillmap_example.{suffix}.txt").read_text("utf-8").strip()


def _socratic_skill_text(fmt: str | None = None) -> str:
    example = _skillmap_example(fmt or openui_format())
    return _socratic_skill_template().replace("{{SKILLMAP_EXAMPLE}}", example)


def _is_socratic_request(mode: str | None, messages: Sequence[ChatMessage]) -> bool:
    if (mode or "").strip().lower() == "tutor":
        return True
    if not messages:
        return False
    last_user = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_user = str(msg.get("content") or "")
            break
    if _SOCRATIC_TRIGGERS.search(last_user):
        return True
    for msg in reversed(messages[-6:]):
        content = str(msg.get("content") or "")
        if msg.get("role") == "assistant" and ('"SkillMap"' in content or "SkillMap(" in content):
            return True
    return False
