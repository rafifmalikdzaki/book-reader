"""Agent tools over the library."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from ..notepad import NotepadError
from ..search import SearchHit, SearchUnavailable
from ..sections import match_sections
from .context import ContextMixin
from .limits import MAX_SOURCE_TEXT
from .model import _tool_error
from .sources import _hit_source

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class SearchArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    query: str = Field(description="Search terms, e.g. a concept or phrase.")
    book: str | None = Field(
        default=None,
        description="Library-relative book path to search inside one book.",
    )
    limit: int | None = Field(default=None, description="Maximum number of hits (1-20).")


class ReadArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    book: str = Field(description="Library-relative book path.")
    page: int | None = Field(default=None, description="PDF page number (1-based).")
    line: int | None = Field(default=None, description="Markdown start line (1-based).")
    count: int | None = Field(
        default=None,
        description="PDF: pages to read (1-10). Markdown: blocks of 25 lines to read.",
    )


class ListBooksArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    query: str = Field(
        default="",
        description="Optional filter matching book title, filename, or category.",
    )
    category: str = Field(
        default="",
        description="Optional category name or id filter.",
    )
    limit: int = Field(default=30, description="Maximum number of books to return (1-60).")


class OutlineArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    book: str = Field(description="Library-relative book path (PDF or Markdown).")


class ReadSectionArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    book: str = Field(description="Library-relative book path (PDF or Markdown).")
    section: str = Field(
        description=(
            "Section title, chapter number (e.g. '3.2' or 'Attention'), or page (e.g. 'p.14') "
            "from get_book_outline."
        )
    )
    max_pages: int = Field(
        default=6,
        description="Maximum pages of the section to read in one call (1-10).",
    )


class ReadNotesArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    book: str | None = Field(
        default=None,
        description="Optional library-relative book path to filter notes.",
    )
    query: str = Field(
        default="",
        description="Optional keyword filter over note quotes and comments.",
    )


class NoteArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    book: str = Field(description="Library-relative book path.")
    quote: str = Field(description="Verbatim passage from the book.")
    comment: str = Field(default="", description="Why the passage matters.")
    page: int | None = Field(default=None, description="PDF page number (1-based).")
    group: str = Field(default="", description="Notepad group id; empty means Inbox.")


class ToolsMixin(ContextMixin):
    """The agent tools: list, outline, read, search, notes."""

    def tool_map(
        self,
        *,
        allowed_books: set[str] | None = None,
        on_step: Callable[[str], None] | None = None,
    ) -> dict[str, BaseTool]:
        def search(query: str, book: str | None = None, limit: int = 5) -> str:
            if on_step:
                target = f" in {Path(book).name}" if book else ""
                on_step(f"Searching library for “{query}”{target}…")
            return self._search_library(query, book, limit, allowed_books=allowed_books)

        def list_books(query: str = "", category: str = "", limit: int = 30) -> str:
            if on_step:
                label = query or category or "all books"
                on_step(f"Browsing library catalog ({label})…")
            return self._list_books(query, category, limit, allowed_books=allowed_books)

        def get_book_outline(book: str) -> str:
            if on_step:
                on_step(f"Inspecting outline of {Path(book).name}…")
            return self._get_book_outline(book, allowed_books=allowed_books)

        def read_section(book: str, section: str, max_pages: int = 6) -> str:
            if on_step:
                on_step(f"Reading section “{section}” in {Path(book).name}…")
            return self._read_section(book, section, max_pages, allowed_books=allowed_books)

        def read_document(
            book: str,
            page: int | None = None,
            line: int | None = None,
            count: int | None = None,
        ) -> str:
            if on_step:
                page_str = f" page {page}" if page else ""
                on_step(f"Reading {Path(book).name}{page_str}…")
            return self._read_document(book, page, line, count, allowed_books=allowed_books)

        def read_notes(book: str | None = None, query: str = "") -> str:
            if on_step:
                on_step("Reading saved researcher notes…")
            return self._read_notes(book, query, allowed_books=allowed_books)

        def add_note(
            book: str,
            quote: str,
            comment: str = "",
            page: int | None = None,
            group: str = "",
        ) -> str:
            if on_step:
                on_step("Saving note to researcher notepad…")
            return self._add_note(book, quote, comment, page, group, allowed_books=allowed_books)

        return {
            "search_library": StructuredTool.from_function(
                func=search,
                name="search_library",
                description=(
                    "Search the book library (Elasticsearch, PageIndex sections, or local text) "
                    "and return ranked hits with book/page/line/section locators."
                ),
                args_schema=SearchArgs,
            ),
            "list_books": StructuredTool.from_function(
                func=list_books,
                name="list_books",
                description=(
                    "List or search books in the library catalog with human-readable PDF titles, "
                    "page counts, and categories."
                ),
                args_schema=ListBooksArgs,
            ),
            "get_book_outline": StructuredTool.from_function(
                func=get_book_outline,
                name="get_book_outline",
                description=(
                    "Get the hierarchical Table of Contents / section outline of a PDF or Markdown "
                    "book with start/end pages or lines."
                ),
                args_schema=OutlineArgs,
            ),
            "read_section": StructuredTool.from_function(
                func=read_section,
                name="read_section",
                description=(
                    "Read a complete section or chapter of a book by section title, number "
                    "(e.g. '3.2'), or page, extracting multi-page text and citations."
                ),
                args_schema=ReadSectionArgs,
            ),
            "read_document": StructuredTool.from_function(
                func=read_document,
                name="read_document",
                description=(
                    "Read text from a book: a PDF page range (up to 10 pages) or a block of "
                    "Markdown lines. Use after search_library or get_book_outline."
                ),
                args_schema=ReadArgs,
            ),
            "read_notes": StructuredTool.from_function(
                func=read_notes,
                name="read_notes",
                description="Read saved highlights and notes from the researcher notepad.",
                args_schema=ReadNotesArgs,
            ),
            "add_note": StructuredTool.from_function(
                func=add_note,
                name="add_note",
                description="Save a quoted passage with a comment into the researcher notepad.",
                args_schema=NoteArgs,
            ),
        }

    def _list_books(
        self,
        query: str = "",
        category: str = "",
        limit: int = 30,
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        limit = max(1, min(60, int(limit or 30)))
        needle = query.casefold().strip()
        cat_needle = category.casefold().strip()

        entries = [
            entry
            for entry in self._library.scan()
            if allowed_books is None or entry.rel in allowed_books
        ]
        pdf_items: list[tuple[str, Path]] = []
        for entry in entries:
            if entry.kind == "pdf":
                found = self._library.find_book(entry.rel)
                if found is not None:
                    pdf_items.append((entry.rel, found))
        meta = self._pages.counts_and_titles(pdf_items) if self._pages and pdf_items else {}

        cat_names: dict[str, str] = {}
        assignments: Mapping[str, Any] = {}
        if self._categories is not None:
            cat_names = {item["id"]: item["name"] for item in self._categories.taxonomy()}
            assignments = self._categories.assignments()

        results: list[dict[str, object]] = []
        for entry in entries:
            pages, cached_title = meta.get(entry.rel, (None, None))
            title = cached_title or entry.title
            cat_label = ""
            if self._reconciler is not None and assignments:
                cid = self._reconciler.content_id(entry.rel)
                if cid and cid in assignments:
                    cat_id = str(assignments[cid].get("category") or "")
                    cat_label = cat_names.get(cat_id, cat_id)
            if cat_needle and cat_needle not in cat_label.casefold():
                continue
            haystack = f"{entry.rel} {title} {cat_label}".casefold()
            if needle and not all(tok in haystack for tok in needle.split()):
                continue
            results.append(
                {
                    "book": entry.rel,
                    "title": title,
                    "kind": entry.kind,
                    "pages": pages,
                    "category": cat_label,
                }
            )
            if len(results) >= limit:
                break
        return json.dumps({"total_in_scope": len(entries), "books": results})

    def _get_book_outline(
        self,
        book: str,
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        if allowed_books is not None and book not in allowed_books:
            return _tool_error(f"book is outside the selected scope: {book}")
        target = self._library.find_book(book)
        if target is None:
            return _tool_error(f"unknown book: {book}")
        if target.suffix.lower() == ".pdf":
            try:
                pages = self._pdf.page_count(target)
                title = self._pdf.title(target) or Path(book).stem
            except Exception as exc:
                return _tool_error(f"cannot open PDF: {exc}")
            sections = self._pdf_sections(book, target)
            return json.dumps(
                {
                    "book": book,
                    "title": title,
                    "kind": "pdf",
                    "pages": pages,
                    "sections": sections[:120],
                }
            )
        md_sections = self._md_sections(target)
        return json.dumps(
            {
                "book": book,
                "title": Path(book).stem,
                "kind": "md",
                "sections": md_sections[:120],
            }
        )

    def _read_section(
        self,
        book: str,
        section: str,
        max_pages: int = 6,
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        if allowed_books is not None and book not in allowed_books:
            return _tool_error(f"book is outside the selected scope: {book}")
        target = self._library.find_book(book)
        if target is None:
            return _tool_error(f"unknown book: {book}")
        max_pages = max(1, min(10, int(max_pages or 6)))

        if target.suffix.lower() == ".pdf":
            sections = self._pdf_sections(book, target)
            matches = match_sections(sections, section)
            if matches:
                chosen = matches[0]
                start = chosen["start_page"]
                end = min(chosen["end_page"], start + max_pages - 1)
                sources: list[dict[str, object]] = []
                chunks: list[str] = []
                char_budget = MAX_SOURCE_TEXT
                for number in range(start, end + 1):
                    try:
                        text = " ".join(self._pdf.page_text(target, number).split())
                    except Exception as exc:
                        return _tool_error(f"cannot read page {number}: {exc}")
                    sources.append({"book": book, "page": number, "section": chosen["title"]})
                    piece = f"[p.{number} · §{chosen['title']}] {text}"
                    if len(piece) > char_budget:
                        chunks.append(piece[:char_budget] + " …")
                        break
                    chunks.append(piece)
                    char_budget -= len(piece)
                    if char_budget <= 0:
                        break
                return json.dumps(
                    {
                        "section": chosen,
                        "has_more_pages": chosen["end_page"] > end,
                        "next_page": end + 1 if chosen["end_page"] > end else None,
                        "sources": sources,
                        "text": "\n\n".join(chunks),
                    }
                )
            # Fallback when PDF has no matching TOC entry: search and read multi-page span
            hits, _backend = self._searcher.in_book(book, target, section, 3)
            if hits and hits[0].get("page"):
                first_page = int(hits[0]["page"] or 1)
                return self._read_document(
                    book,
                    page=first_page,
                    count=min(max_pages, 4),
                    allowed_books=allowed_books,
                )
            return _tool_error(
                f"section '{section}' not found in {book}",
                hint="call get_book_outline(book) or search_library(query, book)",
            )

        # Markdown section extraction
        md_sections = self._md_sections(target)
        try:
            lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            return _tool_error(f"cannot read {book}: {exc}")
        needle = section.casefold().strip()
        chosen_md = next(
            (sec for sec in md_sections if needle in str(sec.get("title", "")).casefold()),
            None,
        )
        if chosen_md is not None:
            start_line = int(str(chosen_md["start_line"]))
            end_line = int(str(chosen_md["end_line"]))
            excerpt = "\n".join(lines[start_line - 1 : end_line])[:MAX_SOURCE_TEXT]
            return json.dumps(
                {
                    "section": chosen_md,
                    "sources": [
                        {
                            "book": book,
                            "line": start_line,
                            "line_end": end_line,
                            "section": str(chosen_md["title"]),
                        }
                    ],
                    "text": excerpt,
                }
            )
        return self._read_document(book, line=1, count=max_pages, allowed_books=allowed_books)

    def _read_notes(
        self,
        book: str | None = None,
        query: str = "",
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        if book and allowed_books is not None and book not in allowed_books:
            return _tool_error(f"book is outside the selected scope: {book}")
        notes = self._notepad.notes(book=book)
        needle = query.casefold().strip()
        filtered: list[dict[str, object]] = []
        sources: list[dict[str, object]] = []
        for note in notes:
            note_book = str(note.get("book") or "")
            if allowed_books is not None and note_book not in allowed_books:
                continue
            quote = str(note.get("quote") or "")
            comment = str(note.get("comment") or "")
            if needle and needle not in f"{quote} {comment} {note_book}".casefold():
                continue
            page = note.get("page")
            filtered.append(
                {
                    "id": note.get("id"),
                    "book": note_book,
                    "page": page,
                    "section": note.get("section", ""),
                    "quote": quote[:600],
                    "comment": comment[:600],
                }
            )
            if note_book:
                sources.append({"book": note_book, "page": page})
        return json.dumps({"notes": filtered[:30], "sources": sources[:20]})

    def _search_library(
        self,
        query: str,
        book: str | None = None,
        limit: int = 5,
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        text = query.strip()
        if not text:
            return _tool_error("query must not be empty")
        limit = max(1, min(20, int(limit or 5)))
        if book:
            if allowed_books is not None and book not in allowed_books:
                return _tool_error(f"book is outside the selected scope: {book}")
            target = self._library.find_book(book)
            if target is None:
                return _tool_error(f"unknown book: {book}")
            try:
                hits, backend = self._searcher.in_book(book, target, text, limit)
            except Exception as exc:
                return _tool_error(f"search failed: {exc}")
            return json.dumps({"backend": backend, "sources": [_hit_source(hit) for hit in hits]})
        try:
            hits = self._search_scope(text, limit, allowed_books)
        except SearchUnavailable as exc:
            return _tool_error(
                str(exc), hint="pass book=<library path> to search inside a single book"
            )
        except Exception as exc:
            return _tool_error(f"search failed: {exc}")
        return json.dumps(
            {"backend": self._searcher.backend(), "sources": [_hit_source(hit) for hit in hits]}
        )

    def _search_scope(
        self, text: str, limit: int, allowed_books: set[str] | None
    ) -> list[SearchHit]:
        if allowed_books is None:
            return self._searcher.library_wide(text, limit)
        if not allowed_books:
            return []
        seen: set[tuple[str, int | None, int | None]] = set()
        hits: list[SearchHit] = []
        for hit in self._searcher.library_wide(text, max(limit * 4, limit)):
            if hit["book"] not in allowed_books:
                continue
            key = (hit["book"], hit["page"], hit["line"])
            if key in seen:
                continue
            seen.add(key)
            hits.append(hit)
            if len(hits) >= limit:
                return hits
        words = [w.casefold() for w in re.findall(r"\w+", text) if len(w) > 2]
        candidate_books = [
            rel for rel in sorted(allowed_books) if any(w in rel.casefold() for w in words)
        ] or sorted(allowed_books)[:5]
        for rel in candidate_books:
            if len(hits) >= limit:
                break
            target = self._library.find_book(rel)
            if target is None:
                continue
            scoped, _backend = self._searcher.in_book(rel, target, text, limit)
            for hit in scoped:
                key = (hit["book"], hit["page"], hit["line"])
                if key in seen:
                    continue
                seen.add(key)
                hits.append(hit)
                if len(hits) >= limit:
                    break
        return hits

    def _read_document(
        self,
        book: str,
        page: int | None = None,
        line: int | None = None,
        count: int | None = None,
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        if allowed_books is not None and book not in allowed_books:
            return _tool_error(f"book is outside the selected scope: {book}")
        target = self._library.find_book(book)
        if target is None:
            return _tool_error(f"unknown book: {book}")
        count = max(1, min(10, int(count or 1)))
        if target.suffix.lower() == ".pdf":
            try:
                pages = self._pdf.page_count(target)
            except Exception as exc:
                return _tool_error(f"cannot open PDF: {exc}")
            start = max(1, min(pages, int(page or 1)))
            end = max(start, min(pages, start + count - 1))
            sources = []
            chunks = []
            for number in range(start, end + 1):
                try:
                    text = " ".join(self._pdf.page_text(target, number).split())
                except Exception as exc:
                    return _tool_error(f"cannot read page {number}: {exc}")
                section = self._sections.section_for_page(book, target, number)
                sources.append({"book": book, "page": number, "section": section})
                chunks.append(
                    f"[p.{number}{f' · §{section}' if section else ''}] {text[:MAX_SOURCE_TEXT]}"
                )
            return json.dumps({"sources": sources, "text": "\n\n".join(chunks)[:MAX_SOURCE_TEXT]})
        try:
            lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            return _tool_error(f"cannot read {book}: {exc}")
        start = max(1, min(len(lines), int(line or 1)))
        end = min(len(lines), start + count * 25 - 1)
        excerpt = "\n".join(lines[start - 1 : end])
        return json.dumps(
            {
                "sources": [{"book": book, "line": start, "line_end": end}],
                "text": excerpt[:MAX_SOURCE_TEXT],
            }
        )

    def _add_note(
        self,
        book: str,
        quote: str,
        comment: str = "",
        page: int | None = None,
        group: str = "",
        *,
        allowed_books: set[str] | None = None,
    ) -> str:
        if allowed_books is not None and book not in allowed_books:
            return _tool_error(f"book is outside the selected scope: {book}")
        target = self._library.find_book(book)
        if target is None:
            return _tool_error(f"unknown book: {book}")
        kind = "md" if target.suffix.lower() == ".md" else "pdf"
        if kind == "pdf" and page is None:
            return _tool_error("pdf notes need a page number")
        if page is not None:
            page = max(1, int(page))
        try:
            note = self._notepad.add_note(
                group=group,
                book=book,
                kind=kind,
                quote=quote,
                page=page,
                comment=comment,
            )
        except NotepadError as exc:
            return _tool_error(str(exc))
        return json.dumps(
            {
                "saved": True,
                "note": note["id"],
                "sources": [{"book": book, "page": page}],
            }
        )
