"""FastAPI application: library index, book views, page rendering, search, progress."""

from __future__ import annotations

import logging
import mimetypes
import os
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .chat.service import ChatService

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

from .api.errors import install as install_errors
from .api.routes.chat import register as register_chat
from .api.routes.chat_sessions import register as register_chat_sessions
from .api.routes.library import register as register_library
from .api.routes.notepad import register as register_notepad
from .api.routes.organize import register as register_organize
from .api.routes.reading import register as register_reading
from .api.routes.search import register as register_search
from .api.routes.spa import register as register_spa
from .api.routes.system import register as register_system
from .api.security import install as install_security_headers
from .api.security import install_host_check
from .api.views import LibraryViews
from .chat.sessions import ChatStore
from .chat.types import ChatBackend
from .library.scan import Library
from .notes.store import NotepadStore
from .organize.categories import CategoryStore
from .organize.mistral import MistralClient
from .organize.service import LibraryOrganizer
from .reading.pages import PageIndex
from .reading.pdf import PdfCache
from .reading.progress import ProgressStore
from .reading.sections import SectionIndex
from .reindex.reconciler import LibraryReconciler
from .search.elastic import ElasticSearch
from .search.service import Searcher
from .state.lock import StateDirectoryLock
from .state.preferences import Preferences

logger = logging.getLogger(__name__)

mimetypes.add_type("text/javascript", ".mjs")

PACKAGE_DIR = Path(__file__).parent
RECENT_LIMIT = 5
DEFAULT_ES_INDEX = "book-reader"


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
        from .chat.service import ChatService

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
    register_library(
        app, views=views, library=library, reconciler=reconciler, pdf=pdf, state_dir=state_path
    )
    register_reading(app, views=views, library=library, progress=progress, pages=pages)
    register_search(app, library=library, searcher=searcher, elastic=elastic, sections=sections)
    register_spa(app, library=library, reconciler=reconciler, spa_dir=static_root / "app")
    install_security_headers(app)

    install_errors(app)
    register_chat(app, chat=chat_service, library=library, preferences=preferences)
    register_organize(app, organizer=organizer)
    register_system(app, reconciler=reconciler)
    if allowed_hosts:
        install_host_check(app, allowed_hosts)
    return app
