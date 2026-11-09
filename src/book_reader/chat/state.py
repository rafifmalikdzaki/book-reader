"""Shared attribute declarations for the ChatService mixins."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..library.scan import Library
from ..notes.store import NotepadStore
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from ..search.service import Searcher
from .types import ProviderConfig

if TYPE_CHECKING:
    from ..organize.categories import CategoryStore
    from ..reading.pages import PageIndex
    from ..reconcile import LibraryReconciler

logger = logging.getLogger(__name__)


class ServiceState:
    """Attributes ChatService sets up; declared here so the mixins can be type-checked."""

    _library: Library
    _searcher: Searcher
    _pdf: PdfCache
    _sections: SectionIndex
    _notepad: NotepadStore
    _pages: PageIndex | None
    _categories: CategoryStore | None
    _reconciler: LibraryReconciler | None
    _providers: list[ProviderConfig]
    # "provider:model" keys whose API rejected reasoning_effort; it is not sent to them again.
    _effort_rejected: set[str]
