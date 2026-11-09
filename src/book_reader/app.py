"""FastAPI factory: process lock, startup reindex, middleware, mounts and route registration."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from fastapi import FastAPI

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
from .api.static import GzipStaticFiles
from .api.static import install as install_static
from .api.views import LibraryViews
from .chat.types import ChatBackend
from .services import build_services
from .state.lock import StateDirectoryLock

logger = logging.getLogger(__name__)

PACKAGE_DIR = Path(__file__).parent


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

    install_static(app)

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
