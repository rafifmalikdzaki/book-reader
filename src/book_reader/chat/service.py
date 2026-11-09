"""ChatService: provider fallback chain around the agent run."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from ..library.scan import Library
from ..notes.store import NotepadStore
from ..reading.pdf import PdfCache
from ..reading.sections import SectionIndex
from ..search.service import Searcher
from .graph import GraphMixin
from .limits import MAX_STEPS
from .model import _chat_model, _extractive_answer, _message_text, provider_key
from .prompts import _is_socratic_request, openui_format
from .providers import resolve_providers
from .registry import model_info
from .sources import _with_context_source, collect_sources
from .tools import ToolsMixin
from .types import AskCallbacks, AskOptions, ChatError, ChatMessage, ChatUnavailable, ProviderConfig

if TYPE_CHECKING:
    from ..organize.categories import CategoryStore
    from ..reading.pages import PageIndex
    from ..reconcile import LibraryReconciler

logger = logging.getLogger(__name__)


class ChatService(ToolsMixin, GraphMixin):
    """Answers questions with tools over the library, trying providers in order."""

    def __init__(
        self,
        library: Library,
        searcher: Searcher,
        pdf: PdfCache,
        sections: SectionIndex,
        notepad: NotepadStore,
        providers: list[ProviderConfig] | None = None,
        *,
        pages: PageIndex | None = None,
        categories: CategoryStore | None = None,
        reconciler: LibraryReconciler | None = None,
    ) -> None:
        self._library = library
        self._searcher = searcher
        self._pdf = pdf
        self._sections = sections
        self._notepad = notepad
        self._pages = pages
        self._categories = categories
        self._reconciler = reconciler
        self._providers = providers if providers is not None else resolve_providers()
        self._effort_rejected = set()

    def providers(self) -> list[ProviderConfig]:
        return list(self._providers)

    def model_options(self) -> list[dict[str, str]]:
        """Selectable provider/model pairs, in priority order and deduplicated."""
        options: list[dict[str, str]] = []
        seen: set[str] = set()
        for provider in self._providers:
            model_id = f"{provider.name}:{provider.model}"
            if model_id in seen:
                continue
            seen.add(model_id)
            info = model_info(model_id)
            options.append(
                {
                    "id": model_id,
                    "provider": provider.name,
                    "model": provider.model,
                    "label": info.label,
                    "openui_format": info.openui_format,
                }
            )
        return options

    def available(self) -> bool:
        return bool(self._providers)

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]:
        options = options or AskOptions()
        callbacks = callbacks or AskCallbacks()
        if not self._providers:
            raise ChatUnavailable(
                "no chat provider configured; set MISTRAL_API_KEY, INCEPTION_API_KEY, "
                "OPENROUTER_API_KEY, or OLLAMA_API_KEY"
            )
        attempts = self._providers
        model = options.model
        if model and model != "auto":
            attempts = [
                provider
                for provider in self._providers
                if f"{provider.name}:{provider.model}" == model
            ]
            if not attempts:
                raise ChatError(f"unknown model: {model}")
        failures: list[str] = []
        for provider in attempts:
            try:
                return self._run(provider, messages, options, callbacks)
            except Exception as exc:
                logger.warning("chat provider %s failed: %s", provider.name, exc)
                failures.append(f"{provider.name}: {exc}")
        raise ChatError("; ".join(failures))

    def _run(
        self,
        provider: ProviderConfig,
        messages: list[ChatMessage],
        options: AskOptions,
        callbacks: AskCallbacks,
    ) -> dict[str, object]:
        book, page = options.book, options.page
        allowed_books, scope = options.allowed_books, options.scope
        steps_recorded: list[str] = []

        def step_tracker(step: str) -> None:
            clean = step.strip()
            if not clean:
                return
            if not steps_recorded or steps_recorded[-1] != clean:
                steps_recorded.append(clean)
            if callbacks.on_step:
                callbacks.on_step(clean)

        step_tracker("Starting research agent…")
        tools = list(
            self.tool_map(
                allowed_books=allowed_books,
                on_step=step_tracker,
                on_found=callbacks.on_found,
            ).values()
        )
        key = provider_key(provider)
        accepts_effort = model_info(key).reasoning_effort is not False
        effort = options.effort if accepts_effort and key not in self._effort_rejected else None
        try:
            model = _chat_model(provider, effort)
        except Exception:
            model = _chat_model(provider)
        bound = model.bind_tools(tools)
        graph = self._graph(
            bound,
            model,
            tools,
            on_step=step_tracker,
            on_token=callbacks.on_token,
            on_thought=callbacks.on_thought,
            provider=provider,
        )
        excerpt = self._page_excerpt(book, page, allowed_books=allowed_books)
        socratic = _is_socratic_request(options.mode, messages)
        history: list[BaseMessage] = [
            SystemMessage(
                content=self._system_prompt(
                    book,
                    page,
                    excerpt=excerpt,
                    scope=scope,
                    allowed_books=allowed_books,
                    socratic=socratic,
                    openui_format=openui_format(key),
                )
            )
        ]
        for message in messages:
            role = message.get("role")
            content = _message_text(message.get("content", ""))
            if role == "assistant":
                history.append(AIMessage(content=content))
            elif role == "user":
                history.append(HumanMessage(content=content))
        state = graph.invoke({"messages": history}, config={"recursion_limit": MAX_STEPS})
        result_messages: list[BaseMessage] = list(state["messages"])
        answer = ""
        for item in reversed(result_messages):
            if isinstance(item, AIMessage) and not item.tool_calls:
                answer = _message_text(item.content)
                break
        tool_sources = collect_sources(result_messages)
        if not answer:
            if not tool_sources:
                raise RuntimeError("provider returned an empty answer")
            answer = _extractive_answer(tool_sources)
            return {
                "answer": answer,
                "sources": tool_sources,
                "provider": provider.name,
                "model": provider.model,
                "thought_steps": steps_recorded,
                "fallback": "extractive",
            }
        return {
            "answer": answer,
            "sources": _with_context_source(tool_sources, book, page, excerpt=excerpt),
            "provider": provider.name,
            "model": provider.model,
            "thought_steps": steps_recorded,
        }
