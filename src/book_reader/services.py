"""Composition root for stores and services: built once per process, shared by the HTTP layer."""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .chat.sessions import ChatStore
from .chat.types import ChatBackend
from .library.scan import Library
from .notes.store import NotepadStore
from .organize.categories import CategoryStore
from .organize.mistral import MistralClient
from .organize.service import LibraryOrganizer
from .papers.fetch import PaperFetcher
from .papers.service import PaperService
from .reading.pages import PageIndex
from .reading.pdf import PdfCache
from .reading.progress import ProgressStore
from .reading.sections import SectionIndex
from .reindex.reconciler import LibraryReconciler
from .search.elastic import ElasticSearch
from .search.service import Searcher
from .state.preferences import Preferences
from .zotero.library import ZoteroLibrary

if TYPE_CHECKING:
    from .chat.service import ChatService

logger = logging.getLogger(__name__)

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
    zotero: ZoteroLibrary | None
    papers: PaperService


def build_services(
    library_root: Path,
    state_dir: Path,
    *,
    es_url: str | None = None,
    es_index: str | None = None,
    search_mode: str | None = None,
    zotero_dir: Path | None = None,
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
        zotero=ZoteroLibrary(zotero_dir) if zotero_dir is not None else None,
        papers=PaperService(
            library,
            PaperFetcher(unpaywall_email=os.environ.get("BOOK_READER_UNPAYWALL_EMAIL", "")),
        ),
    )
