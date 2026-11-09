"""Checker for OpenUI Lang programs, used by the evals and the prompt contract tests.

The authoritative parser is the frontend's ``@openuidev/react-lang`` Renderer. This one only has
to be strict about what makes the Renderer drop a block: syntax errors, a missing ``root``,
unknown components, wrong arity, undefined names and names nothing references. Component
signatures come from the spec generated next to the prompt (``npm run gen:openui-prompt``), so
there is no hand-written copy to drift.
"""

from __future__ import annotations

import functools
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SPEC_PATH = Path(__file__).resolve().parent.parent / "prompts" / "openui_prompt.spec.json"

_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")
_LITERALS: dict[str, Any] = {"true": True, "false": False, "null": None}
_ESCAPES = {"\\": "\\", '"': '"', "n": "\n", "t": "\t"}


class LangSyntaxError(ValueError):
    pass


@dataclass(frozen=True)
class Call:
    name: str
    args: tuple[Any, ...]


@dataclass(frozen=True)
class Ref:
    name: str


@dataclass
class LangProgram:
    """Component specs resolved from ``root`` (field names filled in) plus structural errors."""

    specs: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Signature:
    fields: tuple[str, ...]
    required: int


@functools.lru_cache(maxsize=1)
def signatures() -> dict[str, Signature]:
    """Positional argument names per component; property order is the argument order."""
    defs = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["schema"]["$defs"]
    result: dict[str, Signature] = {}
    for name, definition in defs.items():
        fields = tuple(definition.get("properties", {}))
        required = definition.get("required", [])
        result[name] = Signature(fields, len(required))
    return result


class _Parser:
    def __init__(self, source: str) -> None:
        self.s = source
        self.i = 0

    def fail(self, message: str) -> LangSyntaxError:
        line = self.s.count("\n", 0, self.i) + 1
        return LangSyntaxError(f"line {line}: {message}")

    def skip_space(self) -> None:
        while self.i < len(self.s) and self.s[self.i].isspace():
            self.i += 1

    def peek(self) -> str:
        return self.s[self.i] if self.i < len(self.s) else ""

    def expect(self, char: str) -> None:
        self.skip_space()
        if self.peek() != char:
            raise self.fail(f"expected {char!r}")
        self.i += 1

    def ident(self) -> str:
        self.skip_space()
        match = _IDENT_RE.match(self.s, self.i)
        if not match:
            raise self.fail("expected a name")
        self.i = match.end()
        return match.group()

    def program(self) -> dict[str, Any]:
        statements: dict[str, Any] = {}
        self.skip_space()
        while self.i < len(self.s):
            name = self.ident()
            self.expect("=")
            if name in statements:
                raise self.fail(f"{name} is defined twice")
            statements[name] = self.expr()
            self.skip_space()
        return statements

    def expr(self) -> Any:
        self.skip_space()
        char = self.peek()
        if char == '"':
            return self.string()
        if char == "[":
            return self.sequence("[", "]")
        if char == "{":
            return self.mapping()
        if char == "-" or char.isdigit():
            return self.number()
        name = self.ident()
        if self.peek() == "(":
            return Call(name, tuple(self.sequence("(", ")")))
        return _LITERALS[name] if name in _LITERALS else Ref(name)

    def string(self) -> str:
        self.i += 1
        out: list[str] = []
        while self.i < len(self.s):
            char = self.s[self.i]
            self.i += 1
            if char == '"':
                return "".join(out)
            if char == "\\" and self.i < len(self.s):
                escaped = self.s[self.i]
                self.i += 1
                # Unknown escapes keep their backslash so LaTeX like \frac survives.
                out.append(_ESCAPES.get(escaped, "\\" + escaped))
            else:
                out.append(char)
        raise self.fail("unterminated string")

    def number(self) -> float | int:
        match = _NUMBER_RE.match(self.s, self.i)
        if not match:
            raise self.fail("invalid number")
        self.i = match.end()
        text = match.group()
        return float(text) if any(c in text for c in ".eE") else int(text)

    def sequence(self, opener: str, closer: str) -> list[Any]:
        self.expect(opener)
        items: list[Any] = []
        while True:
            self.skip_space()
            if self.peek() == closer:
                self.i += 1
                return items
            items.append(self.expr())
            self.skip_space()
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != closer:
                raise self.fail(f"expected ',' or {closer!r}")

    def mapping(self) -> dict[str, Any]:
        self.expect("{")
        result: dict[str, Any] = {}
        while True:
            self.skip_space()
            if self.peek() == "}":
                self.i += 1
                return result
            key = self.string() if self.peek() == '"' else self.ident()
            self.expect(":")
            result[key] = self.expr()
            self.skip_space()
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != "}":
                raise self.fail("expected ',' or '}'")


def parse_openui_lang(code: str) -> LangProgram:
    """Parse a program and resolve it from ``root`` into component specs."""
    try:
        statements = _Parser(code).program()
    except LangSyntaxError as exc:
        return LangProgram(errors=[f"syntax error: {exc}"])

    errors: list[str] = []
    if "root" not in statements:
        return LangProgram(errors=["missing root = Answer(...)"])

    reached: set[str] = set()

    def resolve(value: Any, stack: tuple[str, ...]) -> Any:
        if isinstance(value, Ref):
            if value.name not in statements:
                errors.append(f"undefined name: {value.name}")
                return None
            if value.name in stack:
                errors.append(f"circular reference: {value.name}")
                return None
            reached.add(value.name)
            return resolve(statements[value.name], (*stack, value.name))
        if isinstance(value, Call):
            return component(value, stack)
        if isinstance(value, list):
            return [resolve(item, stack) for item in value]
        if isinstance(value, dict):
            return {key: resolve(item, stack) for key, item in value.items()}
        return value

    def component(call: Call, stack: tuple[str, ...]) -> dict[str, Any] | None:
        signature = signatures().get(call.name)
        if signature is None:
            errors.append(f"unknown component: {call.name}")
            return None
        if len(call.args) > len(signature.fields):
            errors.append(f"{call.name} takes at most {len(signature.fields)} arguments")
        if len(call.args) < signature.required:
            errors.append(f"{call.name} needs at least {signature.required} arguments")
        spec: dict[str, Any] = {"component": call.name}
        for name, arg in zip(signature.fields, call.args, strict=False):
            resolved = resolve(arg, stack)
            if resolved is not None:
                spec[name] = resolved
        return spec

    root = resolve(statements["root"], ("root",))
    if not isinstance(root, dict) or root.get("component") != "Answer":
        errors.append("root must be Answer([...])")
        return LangProgram(errors=errors)
    unreferenced = sorted(set(statements) - reached - {"root"})
    if unreferenced:
        errors.append(f"never referenced from root: {', '.join(unreferenced)}")
    blocks = [b for b in root.get("blocks", []) if isinstance(b, dict)]
    if any(block["component"] == "Answer" for block in blocks):
        errors.append("Answer cannot be nested")
    return LangProgram(specs=blocks, errors=errors)


def _literal(value: Any) -> str:
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, list):
        return "[" + ", ".join(_literal(item) for item in value) + "]"
    if isinstance(value, dict):
        pairs = (
            f"{key if _IDENT_RE.fullmatch(key) else _literal(key)}: {_literal(item)}"
            for key, item in value.items()
        )
        return "{" + ", ".join(pairs) + "}"
    return json.dumps(value)


def serialize_openui_lang(specs: list[dict[str, Any]]) -> str:
    """Write component specs (``{"component": ..., field: ...}``) as an OpenUI Lang program."""
    lines: list[str] = []
    names: list[str] = []
    for index, spec in enumerate(specs, start=1):
        signature = signatures()[str(spec["component"])]
        present = [i for i, name in enumerate(signature.fields) if spec.get(name) is not None]
        last = present[-1] if present else -1
        args = [_literal(spec.get(name)) for name in signature.fields[: last + 1]]
        name = f"block{index}"
        names.append(name)
        lines.append(f"{name} = {spec['component']}({', '.join(args)})")
    return "\n".join([f"root = Answer([{', '.join(names)}])", *lines])
