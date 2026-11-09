"""Library index and book-view data for the React SPA.

``LibraryViews`` builds everything the library index and the book readers show;
``register`` exposes it as ``GET /api/library``, ``/api/book``,
``/api/book/markdown`` and ``/api/progress``.
"""

from __future__ import annotations

import contextlib
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import quote, urlencode

from fastapi import FastAPI, HTTPException, Query

from .library.scan import Library
from .mdrender import render_markdown_file
from .notepad import NotepadStore
from .organize import CategoryStore, LibraryOrganizer
from .pages import PageIndex
from .pdf import PdfCache
from .progress import ProgressStore
from .reconcile import LibraryReconciler, ReindexReport
from .sections import SectionIndex

logger = logging.getLogger(__name__)

PDFJS_VIEWER = "/static/vendor/pdfjs/web/viewer.html"


def category_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    return slug or "unsorted"


def shelf_of(rel: str) -> str:
    head, separator, _tail = rel.partition("/")
    return head if separator else "Unfiled"


def label_time(timestamp: object) -> str:
    try:
        value = float(str(timestamp))
    except (TypeError, ValueError):
        return "—"
    if value <= 0:
        return "—"
    return datetime.fromtimestamp(value).strftime("%d %b, %H:%M")


def iso_time(timestamp: object) -> str | None:
    """Local-time ISO 8601 string for an epoch value, or ``None`` when unset."""
    try:
        value = float(str(timestamp))
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return datetime.fromtimestamp(value).astimezone().isoformat(timespec="seconds")


def note_locator(note: dict[str, object]) -> str:
    parts: list[str] = []
    if note.get("kind") == "pdf" and note.get("page"):
        parts.append(f"p.{note['page']}")
    elif note.get("line_start"):
        end = note.get("line_end")
        parts.append(
            f"L{note['line_start']}" + (f"-{end}" if end and end != note["line_start"] else "")
        )
    if note.get("section"):
        parts.append(f"§ {note['section']}")
    return " · ".join(parts)


def note_preview(note: dict[str, object]) -> dict[str, object]:
    return {
        "book": note.get("book"),
        "page": note.get("page"),
        "line_start": note.get("line_start"),
        "quote": " ".join(str(note.get("quote") or "").split())[:220],
        "locator": note_locator(note),
    }


def display_title(
    pdf: PdfCache,
    sections: SectionIndex,
    target: Path,
    rel: str,
    fallback: str,
    page_count: int | None = None,
) -> str:
    if target.suffix.lower() != ".pdf":
        return fallback
    try:
        embedded = pdf.title(target)
        if embedded:
            return embedded
        count = page_count if page_count is not None else pdf.page_count(target)
    except Exception:
        return fallback
    for section in sections.cached(rel):
        if section["depth"] == 0 and section["start_page"] <= 1 and section["end_page"] >= count:
            return section["title"]
    return fallback


def markdown_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^#\s+(.+?)\s*#*$", line)
        if match:
            title = re.sub(r"[*_`\[\]]|\([^)]*\)", "", match.group(1)).strip()
            if title:
                return title
    return fallback


def markdown_outline(text: str) -> list[dict[str, object]]:
    outline: list[dict[str, object]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = re.match(r"^(#{1,4})\s+(.+?)\s*#*$", line)
        if not match:
            continue
        title = re.sub(r"[*_`\[\]]|\([^)]*\)", "", match.group(2)).strip()
        if title:
            outline.append({"level": len(match.group(1)), "title": title, "line": number})
    return outline


def moved_book_target(rel: str, *, library: Library, reconciler: LibraryReconciler) -> str | None:
    """The book's new path if a reindex shows ``rel`` moved, else ``None``."""
    try:
        reconciler.sync()
    except Exception:
        logger.exception("reindex failed while resolving a moved book")
    moved = reconciler.resolve(rel)
    if moved != rel and library.find_book(moved) is not None:
        return moved
    return None


class LibraryViews:
    """Read-side builders for the library index and the book readers."""

    def __init__(
        self,
        *,
        library: Library,
        pdf: PdfCache,
        pages: PageIndex,
        progress: ProgressStore,
        sections: SectionIndex,
        notepad: NotepadStore,
        categories: CategoryStore,
        reconciler: LibraryReconciler,
        organizer: LibraryOrganizer | None,
    ) -> None:
        self.library = library
        self.pdf = pdf
        self.pages = pages
        self.progress = progress
        self.sections = sections
        self.notepad = notepad
        self.categories = categories
        self.reconciler = reconciler
        self.organizer = organizer

    # ---- library index --------------------------------------------------

    def _card(
        self, rel: str, entry: dict[str, object], kind: str, title: str, path: Path
    ) -> dict[str, object]:
        page = entry.get("page")
        scroll = entry.get("scroll")
        count = self.pages.count(rel, path) if kind == "pdf" else None
        percent = 0
        section = ""
        if kind == "pdf" and page:
            percent = round(100 * int(str(page)) / count) if count else 0
            section = self.sections.cached_section_for_page(rel, int(str(page)))
        elif scroll is not None:
            percent = round(100 * float(str(scroll)))
        if kind == "md":
            with contextlib.suppress(OSError):
                title = markdown_title(path.read_text(encoding="utf-8", errors="replace"), title)
        started = bool(page) or scroll is not None
        return {
            "rel": rel,
            "title": display_title(self.pdf, self.sections, path, rel, title, count),
            "kind": kind,
            "shelf": shelf_of(rel),
            "page": int(str(page)) if page else None,
            "page_count": count,
            "percent": max(0, min(100, percent)),
            "section": section,
            "updated_label": label_time(entry.get("updated")) if started else "not started",
            "updated_at": iso_time(entry.get("updated")) if started else None,
        }

    def index(self) -> dict[str, object]:
        """Everything the library index shows.

        Runs a reindex first. ``relocation_notice`` is consumed here: the notice
        for a move is returned once and cleared, so a second call returns ``""``.
        """
        library, progress = self.library, self.progress
        try:
            report = self.reconciler.sync()
        except Exception:
            logger.exception("library reindex failed while rendering the index")
            report = ReindexReport()
        books = library.scan()
        by_rel = {book.rel: book for book in books}
        last_read = {
            rel: float(str(entry.get("updated") or 0.0)) for rel, entry in progress.recent(500)
        }
        resume: dict[str, object] | None = None
        resume_notes: list[dict[str, object]] = []
        recent: list[dict[str, object]] = []
        for rel, entry in progress.recent(8):
            book = by_rel.get(rel)
            path = library.find_book(rel)
            if book is None or path is None:
                continue
            card = self._card(rel, entry, book.kind, book.title, path)
            if resume is None:
                resume = card
                resume_notes = [
                    note_preview(note) for note in reversed(self.notepad.notes(book=rel)[-4:])
                ]
            elif len(recent) < 3:
                recent.append(card)

        count_items: list[tuple[str, Path]] = []
        for book in books:
            path = library.find_book(book.rel)
            if path is not None and book.kind == "pdf":
                count_items.append((book.rel, path))
        meta = self.pages.counts_and_titles(count_items)
        page_counts = {rel: pages for rel, (pages, _) in meta.items()}
        cached_titles = {rel: title for rel, (_, title) in meta.items()}
        taxonomy = self.categories.taxonomy()
        taxonomy_by_id = {item["id"]: item for item in taxonomy}
        assignments = self.categories.assignments()

        rows: list[dict[str, object]] = []
        for book in books:
            stamp = last_read.get(book.rel, 0.0)
            entry = progress.get(book.rel) or {}
            path = library.find_book(book.rel)
            page_count = page_counts.get(book.rel) if book.kind == "pdf" else None
            title = book.title
            if path is not None:
                if book.kind == "md":
                    with contextlib.suppress(OSError):
                        title = markdown_title(
                            path.read_text(encoding="utf-8", errors="replace"), title
                        )
                else:
                    cached_title = cached_titles.get(book.rel)
                    if cached_title:
                        title = cached_title
                    else:
                        title = display_title(
                            self.pdf, self.sections, path, book.rel, title, page_count
                        )
            page = int(str(entry.get("page"))) if entry.get("page") else None
            scroll = float(str(entry.get("scroll"))) if entry.get("scroll") is not None else None
            if book.kind == "pdf" and page and page_count:
                percent = round(100 * page / page_count)
            elif scroll is not None:
                percent = round(100 * scroll)
            else:
                percent = 0
            fallback_category = shelf_of(book.rel)
            content_id = self.reconciler.content_id(book.rel)
            assignment = assignments.get(content_id or "")
            assigned = taxonomy_by_id.get(assignment["category"]) if assignment else None
            category = assigned["name"] if assigned else fallback_category
            category_id = assigned["id"] if assigned else category_slug(fallback_category)
            if taxonomy and not assigned:
                category, category_id = "Unsorted", "unsorted"
            rows.append(
                {
                    "rel": book.rel,
                    "title": title,
                    "kind": book.kind,
                    "shelf": fallback_category,
                    "category_id": category_id,
                    "category_name": category,
                    "page_count": page_count,
                    "page": page,
                    "percent": max(0, min(100, percent)),
                    "thumb_url": (
                        "/thumb.jpg?path=" + quote(book.rel) + "&width=300"
                        if book.kind == "pdf"
                        else ""
                    ),
                    "last_read_label": label_time(stamp),
                    "last_read_at": iso_time(stamp),
                    "updated_label": label_time(entry.get("updated")),
                }
            )
        if taxonomy:
            order = {item["id"]: position for position, item in enumerate(taxonomy)}
            rows.sort(
                key=lambda row: (
                    order.get(str(row["category_id"]), len(order)),
                    str(row["title"]).casefold(),
                )
            )
        else:
            rows.sort(
                key=lambda row: (-last_read.get(str(row["rel"]), 0.0), str(row["title"]).casefold())
            )
        grouped: dict[str, list[dict[str, object]]] = {}
        for row in rows:
            grouped.setdefault(str(row["category_id"]), []).append(row)
        if taxonomy:
            category_names = {item["id"]: item["name"] for item in taxonomy}
            category_names["unsorted"] = "Unsorted"
            ordered_ids = [item["id"] for item in taxonomy if item["id"] in grouped]
            if "unsorted" in grouped:
                ordered_ids.append("unsorted")
        else:
            category_names = {str(row["category_id"]): str(row["category_name"]) for row in rows}
            ordered_ids = list(grouped)
        groups = [
            {
                "id": category_id,
                "name": category_names.get(category_id, category_id),
                "books": grouped[category_id],
            }
            for category_id in ordered_ids
        ]
        organizer = self.organizer
        return {
            "books": rows,
            "groups": groups,
            "category_options": [{"id": group["id"], "name": group["name"]} for group in groups],
            "organize_available": organizer is not None,
            "organize_status": organizer.status()
            if organizer is not None
            else {"available": False},
            "book_count": len(books),
            "resume": resume,
            "resume_notes": resume_notes,
            "recent": recent,
            "relocation_notice": self.reconciler.notice_for(report),
        }

    # ---- books ----------------------------------------------------------

    def stored_progress(self, rel: str) -> dict[str, object]:
        entry = self.progress.get(rel)
        if entry is None:
            return {"page": None, "scroll": None, "updated": None}
        updated = float(str(entry.get("updated") or 0.0))
        return {
            "page": entry.get("page"),
            "scroll": entry.get("scroll"),
            "updated": updated or None,
        }

    def markdown_source(self, target: Path) -> str:
        try:
            return target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    def pdf_view(self, rel: str, target: Path, requested_page: object = None) -> dict[str, object]:
        """Open-state of a PDF: current page, page count, viewer URL or an error.

        An unreadable PDF is not an HTTP error: it returns ``page_count: None``,
        ``viewer_url: None`` and a human ``error`` string (the SPA shows it inline).
        """
        title = display_title(self.pdf, self.sections, target, rel, Path(rel).stem)
        stored = self.stored_progress(rel)
        count = self.pages.count(rel, target)
        if count is None:
            return {
                "kind": "pdf",
                "rel": rel,
                "title": title,
                "page": 1,
                "page_count": None,
                "viewer_url": None,
                "progress": stored,
                "error": f"Cannot open {title}: not a readable PDF",
            }
        requested = str(requested_page or stored.get("page") or 1)
        try:
            current = int(requested)
        except ValueError:
            current = 1
        current = max(1, min(count, current))
        viewer_url = PDFJS_VIEWER + "?" + urlencode({"file": "/raw/" + rel}) + f"#page={current}"
        return {
            "kind": "pdf",
            "rel": rel,
            "title": title,
            "page": current,
            "page_count": count,
            "viewer_url": viewer_url,
            "progress": stored,
            "error": None,
        }

    def markdown_view(self, rel: str, target: Path, *, render: bool = True) -> dict[str, object]:
        """Markdown reader data; ``html`` is the sanitised render (skipped if ``render`` is off)."""
        try:
            html = render_markdown_file(target, file_rel=rel) if render else ""
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"cannot read {rel}") from exc
        source = self.markdown_source(target)
        return {
            "kind": "md",
            "rel": rel,
            "title": markdown_title(source, Path(rel).stem),
            "html": html,
            "outline": markdown_outline(source),
            "progress": self.stored_progress(rel),
            "error": None,
        }

    def book_detail(
        self, rel: str, target: Path, requested_page: object = None
    ) -> dict[str, object]:
        """The ``GET /api/book`` payload (no rendered Markdown)."""
        if target.suffix.lower() == ".md":
            view = self.markdown_view(rel, target, render=False)
            return {
                "kind": "md",
                "rel": rel,
                "title": view["title"],
                "page": None,
                "page_count": None,
                "viewer_url": None,
                "progress": view["progress"],
                "error": None,
            }
        return self.pdf_view(rel, target, requested_page)


def register(
    app: FastAPI,
    *,
    views: LibraryViews,
    library: Library,
    reconciler: LibraryReconciler,
) -> None:
    """Attach the read-only library/book JSON routes."""

    @app.get("/api/library")
    def api_library() -> dict[str, object]:
        return views.index()

    @app.get("/api/book")
    def api_book(
        rel: Annotated[str, Query(alias="path")],
        page: str | None = None,
    ) -> dict[str, object]:
        try:
            target = library.book_file(rel)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            moved = moved_book_target(rel, library=library, reconciler=reconciler)
            if moved is not None:
                # 200, not 307: a fetch() would follow a 307 into the HTML shell.
                return {"redirect": moved}
            raise
        return views.book_detail(rel, target, page)

    @app.get("/api/book/markdown")
    def api_book_markdown(rel: Annotated[str, Query(alias="path")]) -> dict[str, object]:
        target = library.book_file(rel)
        if target.suffix.lower() != ".md":
            raise HTTPException(status_code=400, detail="not a Markdown file")
        return views.markdown_view(rel, target)

    @app.get("/api/progress")
    def api_progress_get(rel: Annotated[str, Query(alias="path")]) -> dict[str, object]:
        library.book_file(rel)
        return {"path": rel, **views.stored_progress(rel)}
