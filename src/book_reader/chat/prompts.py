"""Prompt text and mode detection for the chat agent."""

from __future__ import annotations

import functools
import re
from collections.abc import Sequence
from pathlib import Path

from ..chat_types import ChatMessage

_SOCRATIC_SKILL_PATH = Path(__file__).resolve().parent.parent / "skills" / "socratic_tutor.md"

_SOCRATIC_TRIGGERS = re.compile(
    r"\b(?:"
    r"teach\s+me|tutor\s+me|quiz\s+me|drill\s+me|test\s+my\s+understanding|"
    r"help\s+me\s+master|socratic|show\s+progress|skill\s+map|just\s+tell\s+me|"
    r"save\s+state|resume\s+from\s*:"
    r")\b",
    re.IGNORECASE,
)

_OPENUI_INSTRUCTIONS = (
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


@functools.lru_cache(maxsize=1)
def _socratic_skill_text() -> str:
    try:
        return _SOCRATIC_SKILL_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return (
            "Act as a Socratic tutor: decompose the topic into 4-8 subskills (levels 0-5), "
            "run a short diagnostic one question at a time, render a SkillMap OpenUI block, "
            "and guide the user with one question per turn without lecturing."
        )


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
        if msg.get("role") == "assistant" and '"SkillMap"' in str(msg.get("content") or ""):
            return True
    return False
