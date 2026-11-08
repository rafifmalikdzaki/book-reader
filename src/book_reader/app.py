"""FastAPI application: library index, book views, page rendering, search, progress."""

from __future__ import annotations

import contextlib
import hashlib
import logging
import mimetypes
import os
import re
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Annotated
from urllib.parse import quote, urlencode

if TYPE_CHECKING:
    from .chat import ChatMessage, ChatService

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.datastructures import Headers
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

from .library import Library
from .mdrender import render_markdown_file
from .notepad import NotepadStore
from .organize import CategoryStore, LibraryOrganizer, MistralClient
from .pages import PageIndex
from .pdf import PdfCache
from .preferences import Preferences
from .progress import ProgressStore
from .reconcile import LibraryReconciler, ReindexReport
from .routes_notepad import register as register_notepad
from .search import ElasticSearch, Searcher, SearchUnavailable
from .sections import SectionIndex
from .state_lock import StateDirectoryLock

logger = logging.getLogger(__name__)

mimetypes.add_type("text/javascript", ".mjs")

PACKAGE_DIR = Path(__file__).parent
TEMPLATES = Jinja2Templates(directory=str(PACKAGE_DIR / "templates"))
SEARCH_LIMIT_MAX = 200
RECENT_LIMIT = 5
DEFAULT_ES_INDEX = "book-reader"


class ProgressBody(BaseModel):
    path: str
    page: int | None = None
    scroll: float | None = None


class ChatMessageBody(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessageBody] = []
    book: str | None = None
    page: int | None = None
    model: str | None = None


class ModelChoice(BaseModel):
    model: str


class OrganizeBody(BaseModel):
    confirm: bool = False
    force_taxonomy: bool = False


CHAT_MAX_MESSAGES = 50
CHAT_MAX_MESSAGE_CHARS = 8000


def _chat_model_ids(chat: ChatService) -> set[str]:
    return {option["id"] for option in chat.model_options()}


def _chat_messages(items: list[ChatMessageBody]) -> list[ChatMessage]:
    if not items:
        raise HTTPException(status_code=400, detail="messages must not be empty")
    messages: list[ChatMessage] = []
    for item in items[-CHAT_MAX_MESSAGES:]:
        role = item.role.strip()
        content = item.content.strip()
        if role not in {"user", "assistant"} or not content:
            raise HTTPException(
                status_code=400,
                detail="messages need role user|assistant and non-empty content",
            )
        messages.append({"role": role, "content": content[:CHAT_MAX_MESSAGE_CHARS]})
    return messages


def _select_model(explicit: str | None, preferences: Preferences, chat: ChatService) -> str:
    selected = explicit or preferences.get("chat_model", "auto") or "auto"
    if selected == "auto":
        return selected
    if selected in _chat_model_ids(chat):
        return selected
    if explicit:
        raise HTTPException(status_code=400, detail=f"unknown model: {selected}")
    logger.warning("stored chat model %s is unavailable; using auto", selected)
    return "auto"


@dataclass(frozen=True)
class Services:
    """Everything the HTTP layer needs, built once per process."""

    root: Path
    library: Library
    pdf: PdfCache
    pages: PageIndex
    progress: ProgressStore
    notepad: NotepadStore
    sections: SectionIndex
    elastic: ElasticSearch | None
    searcher: Searcher
    chat: ChatService | None
    preferences: Preferences
    reconciler: LibraryReconciler
    categories: CategoryStore
    organizer: LibraryOrganizer | None


def build_services(
    library_root: Path,
    state_dir: Path,
    *,
    es_url: str | None = None,
    es_index: str | None = None,
    search_mode: str | None = None,
) -> Services:
    root = Path(library_root).resolve()
    state = Path(state_dir)
    url = es_url if es_url is not None else os.environ.get("BOOK_READER_ES_URL", "")
    index = es_index or os.environ.get("BOOK_READER_ES_INDEX", DEFAULT_ES_INDEX)
    mode = search_mode or os.environ.get("BOOK_READER_SEARCH", "auto")
    pdf = PdfCache()
    state_lock = threading.RLock()
    sections = SectionIndex(state, lock=state_lock)
    library = Library(root)
    elastic = ElasticSearch(url, index, pdf, sections, state) if url else None
    searcher = Searcher(library, pdf, sections, elastic, mode)
    notepad = NotepadStore(state, lock=state_lock)
    pages = PageIndex(state, pdf, lock=state_lock)
    progress = ProgressStore(state, lock=state_lock)
    reconciler = LibraryReconciler(
        library,
        state,
        progress=progress,
        notepad=notepad,
        pages=pages,
        sections=sections,
        lock=state_lock,
    )
    categories = CategoryStore(state, lock=state_lock)
    mistral = MistralClient.from_env()
    organizer = (
        LibraryOrganizer(
            library,
            pdf,
            sections,
            reconciler,
            categories,
            mistral,
            lock=state_lock,
        )
        if mistral is not None
        else None
    )
    chat: ChatService | None = None
    try:
        from .chat import ChatService

        chat = ChatService(library, searcher, pdf, sections, notepad)
    except ImportError as exc:
        logger.info("chat disabled: %s", exc)
    return Services(
        root=root,
        library=library,
        pdf=pdf,
        pages=pages,
        progress=progress,
        notepad=notepad,
        sections=sections,
        elastic=elastic,
        searcher=searcher,
        chat=chat,
        preferences=Preferences(state),
        reconciler=reconciler,
        categories=categories,
        organizer=organizer,
    )


def _category_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    return slug or "unsorted"


def _shelf_of(rel: str) -> str:
    head, separator, _tail = rel.partition("/")
    return head if separator else "Unfiled"


def _label_time(timestamp: object) -> str:
    try:
        value = float(str(timestamp))
    except (TypeError, ValueError):
        return "—"
    if value <= 0:
        return "—"
    return datetime.fromtimestamp(value).strftime("%d %b, %H:%M")


def _note_locator(note: dict[str, object]) -> str:
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


def _note_preview(note: dict[str, object]) -> dict[str, object]:
    return {
        "book": note.get("book"),
        "page": note.get("page"),
        "line_start": note.get("line_start"),
        "quote": " ".join(str(note.get("quote") or "").split())[:220],
        "locator": _note_locator(note),
    }


def _display_title(
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


def _markdown_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^#\s+(.+?)\s*#*$", line)
        if match:
            title = re.sub(r"[*_`\[\]]|\([^)]*\)", "", match.group(1)).strip()
            if title:
                return title
    return fallback


def _markdown_outline(text: str) -> list[dict[str, object]]:
    outline = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = re.match(r"^(#{1,4})\s+(.+?)\s*#*$", line)
        if not match:
            continue
        title = re.sub(r"[*_`\[\]]|\([^)]*\)", "", match.group(2)).strip()
        if title:
            outline.append({"level": len(match.group(1)), "title": title, "line": number})
    return outline


class GzipStaticFiles(StaticFiles):
    """Serve precompressed text assets when the browser accepts gzip."""

    async def get_response(self, path: str, scope: object) -> Response:
        headers = Headers(scope=scope)  # type: ignore[arg-type]
        if "gzip" in headers.get("accept-encoding", ""):
            source = Path(str(self.directory)) / path
            compressed = source.with_name(source.name + ".gz")
            if compressed.is_file():
                media_type, _encoding = mimetypes.guess_type(str(source))
                return FileResponse(
                    compressed,
                    media_type=media_type or "application/octet-stream",
                    headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
                )
        return await super().get_response(path, scope)  # type: ignore[arg-type]


def create_app(
    library_root: Path,
    state_dir: Path,
    *,
    es_url: str | None = None,
    es_index: str | None = None,
    search_mode: str | None = None,
    chat: ChatService | None = None,
) -> FastAPI:
    """Build the app with its own library, caches, and stores."""
    state_path = Path(state_dir)
    process_lock = StateDirectoryLock(state_path)
    process_lock.acquire()
    try:
        services = build_services(
            library_root,
            state_path,
            es_url=es_url,
            es_index=es_index,
            search_mode=search_mode,
        )
    except BaseException:
        process_lock.release()
        raise
    root = services.root
    library = services.library
    pdf = services.pdf
    pages = services.pages
    progress = services.progress
    sections = services.sections
    elastic = services.elastic
    searcher = services.searcher
    chat_service = chat if chat is not None else services.chat
    preferences = services.preferences
    notepad = services.notepad
    reconciler = services.reconciler
    categories = services.categories
    organizer = services.organizer

    try:
        startup_report = reconciler.sync()
        if startup_report.count:
            logger.info("startup reindex: %s", startup_report.notice())
    except Exception:
        logger.exception("startup reindex failed; serving the library as-is")

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            process_lock.release()

    app = FastAPI(title="book-reader", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.state_dir_lock = process_lock

    @app.middleware("http")
    async def revalidate_static(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/static/vendor/") or path.startswith("/static/fonts/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=6,
        exclude_content_types=(*DEFAULT_EXCLUDED_CONTENT_TYPES, "application/pdf"),
    )

    app.mount("/static", GzipStaticFiles(directory=str(PACKAGE_DIR / "static")), name="static")
    register_notepad(app, notepad=services.notepad, library=library, pdf=pdf, sections=sections)

    def render(template: str, request: Request, **context: object) -> HTMLResponse:
        return TEMPLATES.TemplateResponse(request, template, {"library_root": str(root), **context})

    def self_card(
        rel: str, entry: dict[str, object], book: object, path: Path
    ) -> dict[str, object]:
        page = entry.get("page")
        scroll = entry.get("scroll")
        count = pages.count(rel, path) if getattr(book, "kind", "") == "pdf" else None
        percent = 0
        section = ""
        if getattr(book, "kind", "") == "pdf" and page:
            percent = round(100 * int(str(page)) / count) if count else 0
            section = sections.cached_section_for_page(rel, int(str(page)))
        elif scroll is not None:
            percent = round(100 * float(str(scroll)))
        title = getattr(book, "title", Path(rel).stem)
        if getattr(book, "kind", "") == "md":
            with contextlib.suppress(OSError):
                title = _markdown_title(path.read_text(encoding="utf-8", errors="replace"), title)
        return {
            "rel": rel,
            "title": _display_title(pdf, sections, path, rel, title, count),
            "kind": getattr(book, "kind", ""),
            "shelf": _shelf_of(rel),
            "page": int(str(page)) if page else None,
            "page_count": count,
            "percent": max(0, min(100, percent)),
            "section": section,
            "updated_label": _label_time(entry.get("updated"))
            if page or scroll is not None
            else "not started",
        }

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> HTMLResponse:
        try:
            report = reconciler.sync()
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
            card = self_card(rel, entry, book, path)
            if resume is None:
                resume = card
                resume_notes = [
                    _note_preview(note) for note in reversed(notepad.notes(book=rel)[-4:])
                ]
            elif len(recent) < 3:
                recent.append(card)

        count_items: list[tuple[str, Path]] = []
        for book in books:
            path = library.find_book(book.rel)
            if path is not None and book.kind == "pdf":
                count_items.append((book.rel, path))
        page_counts = pages.counts(count_items)
        taxonomy = categories.taxonomy()
        taxonomy_by_id = {item["id"]: item for item in taxonomy}
        assignments = categories.assignments()

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
                        title = _markdown_title(
                            path.read_text(encoding="utf-8", errors="replace"), title
                        )
                else:
                    title = _display_title(pdf, sections, path, book.rel, title, page_count)
            page = int(str(entry.get("page"))) if entry.get("page") else None
            scroll = float(str(entry.get("scroll"))) if entry.get("scroll") is not None else None
            if book.kind == "pdf" and page and page_count:
                percent = round(100 * page / page_count)
            elif scroll is not None:
                percent = round(100 * scroll)
            else:
                percent = 0
            fallback_category = _shelf_of(book.rel)
            content_id = reconciler.content_id(book.rel)
            assignment = assignments.get(content_id or "")
            assigned = taxonomy_by_id.get(assignment["category"]) if assignment else None
            category = assigned["name"] if assigned else fallback_category
            category_id = assigned["id"] if assigned else _category_slug(fallback_category)
            if taxonomy and not assigned:
                category, category_id = "Unsorted", "unsorted"
            rows.append(
                {
                    "rel": book.rel,
                    "title": title,
                    "kind": book.kind.upper(),
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
                    "last_read_label": _label_time(stamp),
                    "updated_label": _label_time(entry.get("updated")),
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
        groups: dict[str, list[dict[str, object]]] = {}
        for row in rows:
            groups.setdefault(str(row["category_id"]), []).append(row)
        if taxonomy:
            category_names = {item["id"]: item["name"] for item in taxonomy}
            category_names["unsorted"] = "Unsorted"
            ordered_ids = [item["id"] for item in taxonomy if item["id"] in groups]
            if "unsorted" in groups:
                ordered_ids.append("unsorted")
        else:
            category_names = {str(row["category_id"]): str(row["category_name"]) for row in rows}
            ordered_ids = list(groups)
        book_groups = [
            {
                "id": category_id,
                "name": category_names.get(category_id, category_id),
                "books": groups[category_id],
            }
            for category_id in ordered_ids
        ]
        category_options = [{"id": group["id"], "name": group["name"]} for group in book_groups]
        organizer_status = organizer.status() if organizer is not None else {"available": False}
        return render(
            "index.html",
            request,
            books=rows,
            book_groups=book_groups,
            category_options=category_options,
            organize_available=organizer is not None,
            organize_status=organizer_status,
            book_count=len(books),
            resume=resume,
            resume_notes=resume_notes,
            recent=recent,
            relocation_notice=reconciler.notice_for(report),
        )

    @app.get("/thumb.jpg")
    def thumbnail(
        request: Request,
        rel: Annotated[str, Query(alias="path")],
        width: Annotated[int, Query(ge=120, le=640)] = 300,
    ) -> Response:
        target = library.book_file(rel)
        if target.suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail="not a PDF")
        stat = target.stat()
        content_id = reconciler.content_id(rel)
        if not content_id:
            content_id = hashlib.sha256(
                f"{rel}:{stat.st_size}:{stat.st_mtime_ns}".encode()
            ).hexdigest()
        etag = f'W/"{content_id}-{width}"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        thumb_dir = Path(state_dir) / "thumbs"
        cache = thumb_dir / f"{content_id}-{width}.jpg"
        try:
            if not cache.is_file():
                png = pdf.thumbnail(target, width)
                thumb_dir.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_name(cache.name + ".tmp")
                tmp.write_bytes(png)
                os.replace(tmp, cache)
            data = cache.read_bytes()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"cannot render preview: {exc}") from exc
        return Response(
            data,
            media_type="image/jpeg",
            headers={"ETag": etag, "Cache-Control": "private, max-age=31536000, immutable"},
        )

    @app.get("/book/{rel:path}", response_class=HTMLResponse)
    def book(request: Request, rel: str) -> Response:
        try:
            target = library.book_file(rel)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            try:
                reconciler.sync()
            except Exception:
                logger.exception("reindex failed while resolving a moved book")
            moved = reconciler.resolve(rel)
            if moved != rel and library.find_book(moved) is not None:
                location = f"/book/{quote(moved)}"
                if request.url.query:
                    location += "?" + request.url.query
                return RedirectResponse(url=location, status_code=307)
            raise
        title = _display_title(pdf, sections, target, rel, Path(rel).stem)
        stored = progress.get(rel) or {"page": None, "scroll": None}

        if target.suffix.lower() == ".md":
            try:
                body = render_markdown_file(target, file_rel=rel)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"cannot read {rel}") from exc
            try:
                source = target.read_text(encoding="utf-8", errors="replace")
            except OSError:
                source = ""
            title = _markdown_title(source, title)
            return render(
                "book_md.html",
                request,
                rel=rel,
                title=title,
                html=body,
                outline=_markdown_outline(source),
                progress=stored,
                error=None,
            )

        count = pages.count(rel, target)
        if count is None:
            return render(
                "book_pdf.html",
                request,
                rel=rel,
                title=title,
                page=1,
                page_count=0,
                toc=[],
                progress=stored,
                error=f"Cannot open {title}: not a readable PDF",
            )
        requested = str(request.query_params.get("page") or stored.get("page") or 1)
        try:
            current = int(requested)
        except ValueError:
            current = 1
        current = max(1, min(count, current))
        viewer_url = (
            "/static/vendor/pdfjs/web/viewer.html?"
            + urlencode({"file": "/raw/" + rel})
            + f"#page={current}"
        )
        return render(
            "book_pdf.html",
            request,
            rel=rel,
            title=title,
            page=current,
            page_count=count,
            viewer_url=viewer_url,
            progress=stored,
            error=None,
        )

    @app.get("/raw/{rel:path}")
    def raw(rel: str) -> FileResponse:
        target = library.any_file(rel)
        media_type, _encoding = mimetypes.guess_type(target.name)
        return FileResponse(target, media_type=media_type or "application/octet-stream")

    @app.get("/api/search")
    def api_search(
        q: str = "",
        rel: Annotated[str | None, Query(alias="path")] = None,
        limit: Annotated[int, Query(ge=1, le=SEARCH_LIMIT_MAX)] = 50,
    ) -> dict[str, object]:
        if rel is not None:
            target = library.book_file(rel)
            try:
                hits, backend = searcher.in_book(rel, target, q, limit)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"search failed: {exc}") from exc
            kind = "md" if target.suffix.lower() == ".md" else "pdf"
            return {"kind": kind, "backend": backend, "hits": hits}
        if not q.strip():
            return {"kind": "library", "backend": searcher.backend(), "hits": []}
        try:
            hits = searcher.library_wide(q, limit)
        except SearchUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"kind": "library", "backend": searcher.backend(), "hits": hits}

    @app.post("/api/progress")
    def api_progress(body: ProgressBody) -> dict[str, bool]:
        library.book_file(body.path)
        if body.page is not None and body.page < 1:
            raise HTTPException(status_code=400, detail="page must be >= 1")
        if body.scroll is not None and not 0.0 <= body.scroll <= 1.0:
            raise HTTPException(status_code=400, detail="scroll must be within 0..1")
        if body.page is None and body.scroll is None:
            raise HTTPException(status_code=400, detail="nothing to record")
        progress.update(body.path, page=body.page, scroll=body.scroll)
        return {"ok": True}

    @app.get("/api/pages")
    def api_pages() -> dict[str, object]:
        books = library.scan()
        items: list[tuple[str, Path]] = []
        for book in books:
            if book.kind != "pdf":
                continue
            path = library.find_book(book.rel)
            if path is not None:
                items.append((book.rel, path))
        counts = pages.counts(items)
        response: dict[str, int | None] = {}
        for book in books:
            if book.kind != "pdf":
                response[book.rel] = None
            elif book.rel in counts:
                response[book.rel] = counts[book.rel]
        return {"counts": response}

    @app.post("/api/index/rebuild")
    def api_index_rebuild(force: bool = False) -> dict[str, object]:
        if elastic is None:
            raise HTTPException(
                status_code=503,
                detail="Elasticsearch is not configured; set BOOK_READER_ES_URL",
            )
        if not elastic.reachable():
            raise HTTPException(
                status_code=503, detail=f"Elasticsearch is not reachable at {elastic.url}"
            )
        started = elastic.rebuild_job.start(lambda: elastic.rebuild(library, force=force))
        return {"ok": True, "started": started, "job": elastic.rebuild_job.snapshot()}

    @app.post("/api/library/reindex")
    def api_library_reindex() -> dict[str, object]:
        try:
            report = reconciler.sync()
        except Exception as exc:
            logger.exception("manual reindex failed")
            raise HTTPException(status_code=500, detail=f"reindex failed: {exc}") from exc
        return report.as_dict()

    @app.get("/api/organize/status")
    def api_organize_status() -> dict[str, object]:
        if organizer is None:
            return {"available": False, "running": False, "reason": "Mistral is not configured"}
        return organizer.status()

    @app.post("/api/organize", status_code=202)
    def api_organize(body: OrganizeBody) -> dict[str, object]:
        if organizer is None:
            raise HTTPException(
                status_code=503,
                detail="Mistral is not configured; set MISTRAL_API_KEY or MISTRAL_API",
            )
        if not body.confirm:
            raise HTTPException(status_code=400, detail="organize requires confirm=true")
        if not organizer.start(force_taxonomy=body.force_taxonomy):
            raise HTTPException(status_code=409, detail="organize is already running")
        return {"started": True, "status": organizer.status()}

    @app.get("/api/index/status")
    def api_index_status() -> dict[str, object]:
        present_books = {book.rel for book in library.scan()}
        return {
            "elasticsearch": {
                "url": elastic.url if elastic else None,
                "index": elastic.index if elastic else None,
                "available": bool(elastic and elastic.available()),
                "reachable": bool(elastic and elastic.reachable()),
                "chunks": elastic.chunk_count() if elastic else None,
                "job": elastic.rebuild_job.snapshot() if elastic else None,
            },
            "pageindex": {
                "available": sections.available(),
                "cached_books": len(
                    [rel for rel in sections.cached_books() if rel in present_books]
                ),
            },
            "search_backend": searcher.backend(),
        }

    @app.get("/api/chat/status")
    def api_chat_status() -> dict[str, object]:
        selected = preferences.get("chat_model", "auto")
        if chat_service is None:
            return {
                "available": False,
                "providers": [],
                "reason": "agent extra not installed",
                "selected": selected,
            }
        return {
            "available": chat_service.available(),
            "providers": chat_service.model_options(),
            "selected": selected,
        }

    @app.get("/api/chat/options")
    def api_chat_options() -> dict[str, object]:
        if chat_service is None:
            return {"available": False, "models": [], "selected": "auto"}
        return {
            "available": chat_service.available(),
            "models": chat_service.model_options(),
            "selected": preferences.get("chat_model", "auto"),
        }

    @app.post("/api/chat/options")
    def api_chat_options_save(choice: ModelChoice) -> dict[str, object]:
        model = choice.model.strip() or "auto"
        if model != "auto":
            if chat_service is None:
                raise HTTPException(status_code=503, detail="chat is not configured")
            if model not in _chat_model_ids(chat_service):
                raise HTTPException(status_code=400, detail=f"unknown model: {model}")
        preferences.set("chat_model", model)
        return {"ok": True, "selected": model}

    @app.post("/api/chat")
    def api_chat(body: ChatBody) -> dict[str, object]:
        try:
            from .chat import ChatError, ChatUnavailable
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra",
            ) from exc

        if chat_service is None:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra and set a provider key",
            )
        messages = _chat_messages(body.messages)
        if body.book is not None:
            library.book_file(body.book)
        selected = _select_model(body.model, preferences, chat_service)
        try:
            return chat_service.ask(messages, book=body.book, page=body.page, model=selected)
        except ChatUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ChatError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.exception_handler(HTTPException)
    def http_error(request: Request, exc: HTTPException) -> Response:
        accept = request.headers.get("accept", "")
        json_only = "application/json" in accept and "text/html" not in accept
        if request.url.path.startswith("/api") or json_only:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        headings = {
            400: "That address isn't a book",
            404: "We couldn't find that",
            500: "Something broke",
        }
        details = {
            400: "The path points outside the library, or to a file this reader does not open.",
            404: "That book is not in this library. It may have been moved or renamed.",
            500: "The reader hit an error while opening this file.",
        }
        return TEMPLATES.TemplateResponse(
            request,
            "error.html",
            {
                "library_root": str(root),
                "status": exc.status_code,
                "heading": headings.get(exc.status_code, "Something broke"),
                "detail": details.get(exc.status_code, str(exc.detail)),
            },
            status_code=exc.status_code,
        )

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    return app
