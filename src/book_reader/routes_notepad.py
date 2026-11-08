"""HTTP routes for the researcher notepad and its AI-context export."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from .library import Library
from .notepad import MAX_COMMENT, MAX_GROUP_NAME, MAX_QUOTE, NotepadError, NotepadStore
from .pdf import PdfCache
from .sections import SectionIndex


class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_GROUP_NAME)


class NoteBody(BaseModel):
    book: str
    kind: Literal["pdf", "md"]
    quote: str = Field(min_length=1, max_length=MAX_QUOTE)
    group: str = ""
    page: int | None = None
    section: str = ""
    word_start: int | None = None
    word_end: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    paragraph: int | None = None
    comment: str = Field(default="", max_length=MAX_COMMENT)


class NotePatch(BaseModel):
    comment: str | None = Field(default=None, max_length=MAX_COMMENT)
    group: str | None = None


def register(
    app: FastAPI,
    *,
    notepad: NotepadStore,
    library: Library,
    pdf: PdfCache,
    sections: SectionIndex,
) -> None:
    """Attach notepad routes; dependencies are injected by the app factory."""
    router = APIRouter(prefix="/api/notepad", tags=["notepad"])

    @router.get("")
    def snapshot(group: str | None = None, book: str | None = None) -> dict[str, object]:
        return {"groups": notepad.groups(), "notes": notepad.notes(group=group, book=book)}

    @router.post("/groups")
    def create_group(body: GroupBody) -> dict[str, object]:
        try:
            return notepad.create_group(body.name)
        except NotepadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.delete("/groups/{group_id}")
    def delete_group(group_id: str) -> dict[str, int]:
        try:
            return {"removed_notes": notepad.delete_group(group_id)}
        except NotepadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/notes")
    def add_note(body: NoteBody) -> dict[str, object]:
        target = library.book_file(body.book)
        kind = "md" if target.suffix.lower() == ".md" else "pdf"
        if kind != body.kind:
            raise HTTPException(status_code=400, detail="kind does not match the book")

        char_start, char_end = body.char_start, body.char_end
        line_start: int | None = None
        line_end: int | None = None
        paragraph = body.paragraph
        if kind == "pdf":
            if body.page is None:
                raise HTTPException(status_code=400, detail="pdf notes need a page number")
            if not body.section:
                body.section = sections.cached_section_for_page(body.book, body.page)
            if body.word_start is not None and body.word_end is not None:
                try:
                    layer = pdf.page_words(target, body.page)
                except Exception as exc:
                    raise HTTPException(
                        status_code=400, detail=f"cannot read page text: {exc}"
                    ) from exc
                words = layer["words"]
                if isinstance(words, list):
                    start = min(body.word_start, body.word_end)
                    end = max(body.word_start, body.word_end)
                    if 0 <= start <= end < len(words):
                        first = words[start]
                        last = words[end]
                        if isinstance(first, dict) and isinstance(first.get("b"), int):
                            paragraph = first["b"]
                        if isinstance(first, dict) and isinstance(first.get("l"), int):
                            line_start = first["l"]
                            if isinstance(last, dict) and isinstance(last.get("l"), int):
                                line_end = last["l"]
                    offsets = _word_offsets(words, start, end)
                    if offsets is not None:
                        char_start, char_end = offsets
            elif char_start is None and char_end is None:
                try:
                    text = pdf.page_text(target, body.page)
                except Exception:
                    text = ""
                needle = body.quote.strip()
                found = text.find(needle) if needle else -1
                if found >= 0:
                    char_start, char_end = found, found + len(needle)
        else:
            char_start, char_end, line_start, line_end = _markdown_locator(target, body.quote)

        try:
            return notepad.add_note(
                group=body.group,
                book=body.book,
                kind=kind,
                quote=body.quote,
                page=body.page,
                section=body.section,
                char_start=char_start,
                char_end=char_end,
                line_start=line_start,
                line_end=line_end,
                paragraph=paragraph,
                comment=body.comment,
            )
        except NotepadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.patch("/notes/{note_id}")
    def update_note(note_id: str, body: NotePatch) -> dict[str, object]:
        try:
            return notepad.update_note(note_id, comment=body.comment, group=body.group or None)
        except NotepadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.delete("/notes/{note_id}")
    def delete_note(note_id: str) -> dict[str, bool]:
        try:
            notepad.delete_note(note_id)
        except NotepadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True}

    @router.get("/export")
    def export(
        fmt: Annotated[Literal["markdown", "json"], Query(alias="format")] = "markdown",
        group: str | None = None,
    ) -> Response:
        if fmt == "json":
            return JSONResponse(notepad.export_json(group))
        return PlainTextResponse(
            notepad.export_markdown(group),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="reading-notes.md"'},
        )

    app.include_router(router)


def _word_offsets(words: list[dict[str, object]], start: int, end: int) -> tuple[int, int] | None:
    """Character offsets of a word span inside the page's space-joined text."""
    if start < 0 or end < start or end >= len(words):
        return None
    starts: list[int] = []
    offset = 0
    for word in words:
        starts.append(offset)
        offset += len(str(word.get("t", ""))) + 1
    return starts[start], starts[end] + len(str(words[end].get("t", "")))


_INLINE_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
# Only strip emphasis/code markers at word boundaries so `snake_case` survives.
_INLINE_MARKS = re.compile(r"(?<![0-9A-Za-z])[*_`]+|[*_`]+(?![0-9A-Za-z])")
_LIST_MARKER = re.compile(r"^(?:[-+*]|\d+[.)])\s+")


def _plain_markdown_line(line: str) -> str:
    """Approximate the rendered text of one Markdown source line."""
    line = _INLINE_LINK.sub(r"\1", line)
    line = _INLINE_MARKS.sub("", line)
    line = _LIST_MARKER.sub("", line)
    line = line.lstrip("#> ").strip()
    return " ".join(line.split())


def _markdown_locator(
    path: Path, quote: str
) -> tuple[int | None, int | None, int | None, int | None]:
    """Locate a quoted passage in the Markdown source.

    Browser selections carry rendered text (no ``#``/``[]()``/``*`` markers),
    so the source is compared through a per-line plain-text projection.
    """
    needle = " ".join(quote.split())
    if not needle:
        return None, None, None, None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, None, None, None

    exact = text.find(quote.strip())
    if exact >= 0:
        span = len(quote.strip())
        return (
            exact,
            exact + span,
            text.count("\n", 0, exact) + 1,
            text.count("\n", 0, exact + span) + 1,
        )

    raw_lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    projected: list[str] = []
    offset = 0
    for line in raw_lines:
        offsets.append(offset)
        offset += len(line)
        projected.append(_plain_markdown_line(line))

    for start, line in enumerate(projected):
        if not line:
            continue
        if needle in line:
            return (
                offsets[start],
                offsets[start] + len(raw_lines[start].rstrip("\n")),
                start + 1,
                start + 1,
            )
        if not needle.startswith(line):
            continue
        joined = line
        end = start
        while len(joined) < len(needle) and end + 1 < len(projected):
            end += 1
            joined = f"{joined} {projected[end]}".strip()
        if needle.startswith(joined) or needle in joined:
            last_line = raw_lines[end].rstrip("\n")
            return (
                offsets[start],
                offsets[end] + len(last_line),
                start + 1,
                end + 1,
            )
    return None, None, None, None
