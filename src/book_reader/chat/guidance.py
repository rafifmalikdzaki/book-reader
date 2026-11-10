"""Steering modules for the Ask agent, selected per question.

The system prompt used to be one document that carried the full OpenUI format guide, the
teacher instructions and every tool strategy on every request. Each module here is a small,
named piece of steering with the tools it needs and the question shapes it suits. Selection is
deterministic — no model call, no extra tokens — so guidance is applied automatically and the
request only pays for what the question needs.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from pathlib import Path

_STEERING_DIR = Path(__file__).resolve().parent.parent / "skills" / "steering"

# Read-only tools; the fallback set when no module matches, so capability never shrinks.
READ_TOOLS = (
    "search_library",
    "list_books",
    "get_book_outline",
    "read_section",
    "read_document",
    "read_notes",
)
# `add_note` writes state and is offered only when the question is about notes.
WRITE_TOOL = "add_note"


@functools.cache
def _skill_text(name: str) -> str:
    try:
        return (_STEERING_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


@dataclass(frozen=True)
class Skill:
    """One steering module: when it applies, what it says, and the tools it needs."""

    id: str
    label: str
    prompt: str
    tools: tuple[str, ...]
    pattern: re.Pattern[str] | None = None
    priority: int = 0
    visual: bool = False


@dataclass(frozen=True)
class Guidance:
    """The modules chosen for one question and the tools they make available."""

    skills: tuple[Skill, ...]
    tools: tuple[str, ...]
    visual: bool

    @property
    def labels(self) -> tuple[str, ...]:
        return tuple(skill.label for skill in self.skills if skill.id != "core")


CORE = Skill(
    id="core",
    label="Core",
    prompt=_skill_text("core"),
    tools=("search_library",),
)

TUTOR = Skill(
    id="tutor",
    label="Socratic tutor",
    prompt="",  # the format-specific tutor text is appended by the prompt builder
    tools=("read_section", "read_notes", WRITE_TOOL),
    priority=100,
    visual=True,
)

LOOKUP = Skill(
    id="lookup",
    label="Locate",
    prompt=_skill_text("lookup"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\b(?:what|which)\s+page\b|\bpage\s+\d+|\bwhere\s+(?:is|are|does)\b|"
        r"\bwhich\s+(?:chapter|section)\b|\blocate\b|\bfind\s+the\s+passage\b",
    ),
    priority=90,
)

COMPARE = Skill(
    id="compare",
    label="Compare",
    prompt=_skill_text("compare"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\bcompare\b|\bcomparison\b|\bversus\b|\bvs\.?\b|\bdifferences?\s+between\b|"
        r"\btrade-?offs?\b|\bpros\s+and\s+cons\b|\bbetter\s+than\b",
    ),
    priority=80,
    visual=True,
)

DERIVE = Skill(
    id="derive",
    label="Derive",
    prompt=_skill_text("derive"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\bderive\b|\bderivation\b|\bprove\b|\bproof\b|\bstep[- ]by[- ]step\b|"
        r"\balgorithm\b|\bcomplexity\b|\bwalk\s+me\s+through\b",
    ),
    priority=75,
    visual=True,
)

DIAGRAM = Skill(
    id="diagram",
    label="Map",
    prompt=_skill_text("diagram"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\barchitecture\b|\bhow\s+do\s+.+\s+connect\b|\bconnections?\b|\bflow\b|"
        r"\bpipeline\b|\bdiagram\b|\bconcept\s+graph\b",
    ),
    priority=70,
    visual=True,
)

METRICS = Skill(
    id="metrics",
    label="Quantify",
    prompt=_skill_text("metrics"),
    tools=("get_book_outline", "read_section"),
    pattern=re.compile(
        r"\bbenchmarks?\b|\bmetrics?\b|\bmeasurements?\b|\bplot\b|\bchart\b|\blatency\b|"
        r"\bthroughput\b|\bhow\s+(?:fast|many|much)\b|\bnumbers?\b",
    ),
    priority=65,
    visual=True,
)

SURVEY = Skill(
    id="survey",
    label="Survey library",
    prompt=_skill_text("survey"),
    tools=("list_books", "get_book_outline", "read_section", "read_notes"),
    pattern=re.compile(
        r"\brecommend|\bwhich\s+books?\b|\bwhat\s+should\s+i\s+read\b|\breading\s+list\b|"
        r"\bsurvey\b|\bbooks?\s+(?:cover|about|on)\b",
    ),
    priority=60,
    visual=True,
)

NOTES = Skill(
    id="notes",
    label="Notes",
    prompt=_skill_text("notes"),
    tools=("read_notes", WRITE_TOOL),
    pattern=re.compile(
        r"\bnotes?\b|\bhighlights?\b|\bsave\s+(?:this|that|it)\b|\bremember\s+this\b|"
        r"\bquote\b|\bannotate\b",
    ),
    priority=55,
)

DEEP_READ = Skill(
    id="deep-read",
    label="Read deeply",
    prompt=_skill_text("deep-read"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\bsummari[sz]e\b|\bsummary\b|\bchapters?\b|\bsections?\b|\bentire\s+(?:book|chapter)\b|"
        r"\bwhole\s+(?:book|chapter)\b|\bfull\s+text\b|\bdeep\s+dive\b|\banaly[sz]e\b",
    ),
    priority=50,
)

CONCEPT = Skill(
    id="concept",
    label="Explain",
    prompt=_skill_text("concept"),
    tools=("get_book_outline", "read_section", "read_document"),
    pattern=re.compile(
        r"\bexplain\b|\bwhat\s+(?:is|are)\b|\bwhy\b|\bhow\s+(?:does|do|did)\b|"
        r"\bmeaning\b|\bdefinitions?\b|\bintuition\b",
    ),
    priority=40,
    visual=True,
)

SKILLS = (
    LOOKUP,
    COMPARE,
    DERIVE,
    DIAGRAM,
    METRICS,
    SURVEY,
    NOTES,
    DEEP_READ,
    CONCEPT,
)
# Two shapes are enough for one answer; more instruction than that competes with itself.
MAX_MATCHED = 2


def select_guidance(question: str, *, socratic: bool = False) -> Guidance:
    """The steering modules and tools for ``question``, chosen without a model call."""
    if socratic:
        matched: tuple[Skill, ...] = (TUTOR,)
    else:
        text = " ".join(question.casefold().split())
        hits = [
            skill for skill in SKILLS if skill.pattern is not None and skill.pattern.search(text)
        ]
        hits.sort(key=lambda skill: skill.priority, reverse=True)
        matched = tuple(hits[:MAX_MATCHED])

    tools: list[str] = list(CORE.tools)
    for skill in matched:
        tools.extend(skill.tools)
    if not matched:
        tools.extend(READ_TOOLS)
    return Guidance(
        skills=(CORE, *matched),
        tools=tuple(dict.fromkeys(tools)),
        visual=any(skill.visual for skill in matched),
    )
