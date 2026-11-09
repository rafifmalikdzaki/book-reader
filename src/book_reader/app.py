"""FastAPI application: library index, book views, page rendering, search, progress."""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

if TYPE_CHECKING:
    from .chat import ChatService

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.datastructures import Headers
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

from .chat_config import (
    CHAT_EFFORTS,
    CHAT_MAX_MESSAGE_CHARS,
    CHAT_MAX_MESSAGES,
    DEFAULT_CHAT_EFFORT,
    chat_model_ids,
    select_model,
)
from .chat_types import AskOptions, ChatBackend, ChatError, ChatMessage, ChatUnavailable
from .chats import ChatStore
from .library.scan import Library
from .notepad import NotepadStore
from .organize import CategoryStore, LibraryOrganizer, MistralClient
from .reading.pages import PageIndex
from .reading.pdf import PdfCache
from .reading.progress import ProgressStore
from .reading.sections import SectionIndex
from .reconcile import LibraryReconciler
from .routes_chat_sessions import register as register_chat_sessions
from .routes_library import LibraryViews
from .routes_library import register as register_library
from .routes_notepad import register as register_notepad
from .routes_spa import register as register_spa
from .search import ElasticSearch, Searcher, SearchUnavailable
from .security_headers import install as install_security_headers
from .security_headers import install_host_check
from .state.lock import StateDirectoryLock
from .state.preferences import Preferences

logger = logging.getLogger(__name__)

mimetypes.add_type("text/javascript", ".mjs")

PACKAGE_DIR = Path(__file__).parent
SEARCH_LIMIT_MAX = 200
RECENT_LIMIT = 5
DEFAULT_ES_INDEX = "book-reader"

# Only these types are safe to render inline from the library. Everything else is a
# download with a generic media type (notably HTML/SVG, which would run on our origin).
RAW_INLINE_MEDIA = {
    ".pdf": "application/pdf",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
}


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
    mode: str | None = None
    effort: str | None = None


class ModelChoice(BaseModel):
    model: str | None = None
    effort: str | None = None


class OrganizeBody(BaseModel):
    confirm: bool = False
    force_taxonomy: bool = False


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


@dataclass(frozen=True)
class Services:
    """Everything the HTTP layer needs, built once per process."""

    root: Path
    library: Library
    pdf: PdfCache
    pages: PageIndex
    progress: ProgressStore
    notepad: NotepadStore
    chats: ChatStore
    sections: SectionIndex
    elastic: ElasticSearch | None
    searcher: Searcher
    chat: ChatBackend | None
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
    chats = ChatStore(state, lock=state_lock)
    pages = PageIndex(state, pdf, lock=state_lock)
    progress = ProgressStore(state, lock=state_lock)
    reconciler = LibraryReconciler(
        library,
        state,
        progress=progress,
        notepad=notepad,
        chats=chats,
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

        chat = ChatService(
            library,
            searcher,
            pdf,
            sections,
            notepad,
            pages=pages,
            categories=categories,
            reconciler=reconciler,
        )
    except ImportError as exc:
        logger.info("chat disabled: %s", exc)
    return Services(
        root=root,
        library=library,
        pdf=pdf,
        pages=pages,
        progress=progress,
        notepad=notepad,
        chats=chats,
        sections=sections,
        elastic=elastic,
        searcher=searcher,
        chat=chat,
        preferences=Preferences(state),
        reconciler=reconciler,
        categories=categories,
        organizer=organizer,
    )


class GzipStaticFiles(StaticFiles):
    """Serve precompressed text assets when the browser accepts gzip."""

    async def get_response(self, path: str, scope: object) -> Response:
        headers = Headers(scope=scope)  # type: ignore[arg-type]
        if "gzip" in headers.get("accept-encoding", ""):
            root = Path(str(self.directory)).resolve()
            source: Path | None = None
            compressed: Path | None = None
            try:
                source = (root / path).resolve()
                compressed = source.with_name(source.name + ".gz").resolve()
            except (OSError, RuntimeError):
                pass
            if (
                source is not None
                and compressed is not None
                and source.is_relative_to(root)
                and compressed.is_relative_to(root)
                and compressed.is_file()
            ):
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
    chat: ChatBackend | None = None,
    static_dir: Path | None = None,
    allowed_hosts: Sequence[str] | None = None,
) -> FastAPI:
    """Build the app with its own library, caches, and stores.

    ``static_dir`` overrides the packaged static folder (tests use a tmp bundle).
    ``allowed_hosts`` rejects requests whose Host header is not listed (DNS-rebinding
    guard); ``None`` disables the check.
    """
    static_root = static_dir if static_dir is not None else PACKAGE_DIR / "static"
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
    chats = services.chats
    reconciler = services.reconciler
    categories = services.categories
    organizer = services.organizer

    try:
        startup_report = reconciler.sync()
        if startup_report.count:
            logger.info("startup reindex: %s", startup_report.notice())
    except Exception:
        logger.exception("startup reindex failed; serving the library as-is")
    try:
        chats.remove_expired()
    except Exception:
        logger.exception("chat retention cleanup failed")

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
        if path.startswith(("/static/vendor/", "/static/fonts/", "/static/app/assets/")):
            # Pinned or hashed files. A miss (mid-rebuild, typo) must not be cached; 304 and 206
            # keep `immutable` so a conditional or range request does not downgrade the stored copy.
            immutable = "public, max-age=31536000, immutable"
            response.headers["Cache-Control"] = (
                immutable if response.status_code in (200, 206, 304) else "no-cache"
            )
        elif path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=6,
        exclude_content_types=(*DEFAULT_EXCLUDED_CONTENT_TYPES, "application/pdf"),
    )

    app.mount("/static", GzipStaticFiles(directory=str(static_root)), name="static")
    register_notepad(app, notepad=services.notepad, library=library, pdf=pdf, sections=sections)
    register_chat_sessions(
        app,
        chats=chats,
        library=library,
        categories=categories,
        chat=chat_service,
        preferences=preferences,
        reconciler=reconciler,
    )
    views = LibraryViews(
        library=library,
        pdf=pdf,
        pages=pages,
        progress=progress,
        sections=sections,
        notepad=notepad,
        categories=categories,
        reconciler=reconciler,
        organizer=organizer,
    )
    register_library(app, views=views, library=library, reconciler=reconciler)
    register_spa(app, library=library, reconciler=reconciler, spa_dir=static_root / "app")
    install_security_headers(app)

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

    @app.get("/raw/{rel:path}")
    def raw(rel: str) -> FileResponse:
        target = library.any_file(rel)
        media_type = RAW_INLINE_MEDIA.get(target.suffix.lower())
        if media_type is not None:
            return FileResponse(
                target,
                media_type=media_type,
                headers={"X-Content-Type-Options": "nosniff"},
            )
        return FileResponse(
            target,
            media_type="application/octet-stream",
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": "attachment",
            },
        )

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
            return {
                "available": False,
                "models": [],
                "selected": "auto",
                "effort": DEFAULT_CHAT_EFFORT,
            }
        return {
            "available": chat_service.available(),
            "models": chat_service.model_options(),
            "selected": preferences.get("chat_model", "auto"),
            "effort": preferences.get("chat_effort", DEFAULT_CHAT_EFFORT),
        }

    @app.post("/api/chat/options")
    def api_chat_options_save(choice: ModelChoice) -> dict[str, object]:
        model: str | None = None
        if choice.model is not None:
            model = choice.model.strip() or "auto"
            if model != "auto":
                if chat_service is None:
                    raise HTTPException(status_code=503, detail="chat is not configured")
                if model not in chat_model_ids(chat_service):
                    raise HTTPException(status_code=400, detail=f"unknown model: {model}")
        effort: str | None = None
        if choice.effort is not None:
            effort = choice.effort.strip().lower()
            if effort not in CHAT_EFFORTS:
                raise HTTPException(status_code=400, detail=f"unknown effort: {choice.effort}")
        resp: dict[str, object] = {"ok": True}
        if model is not None:
            preferences.set("chat_model", model)
            resp["selected"] = model
        if effort is not None:
            preferences.set("chat_effort", effort)
            resp["effort"] = effort
        return resp

    @app.post("/api/chat")
    def api_chat(body: ChatBody) -> dict[str, object]:
        if chat_service is None:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra and set a provider key",
            )
        messages = _chat_messages(body.messages)
        if body.book is not None:
            library.book_file(body.book)
        selected = select_model(body.model, preferences, chat_service)
        selected_effort = body.effort or preferences.get("chat_effort", DEFAULT_CHAT_EFFORT)
        try:
            options = AskOptions(
                book=body.book,
                page=body.page,
                model=selected,
                mode=body.mode or None,
                effort=selected_effort,
            )
            return chat_service.ask(messages, options)
        except ChatUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ChatError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.exception_handler(HTTPException)
    def http_error(_request: Request, exc: HTTPException) -> Response:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    if allowed_hosts:
        install_host_check(app, allowed_hosts)
    return app
