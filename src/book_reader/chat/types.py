"""Chat types shared by the HTTP routes, the service and tests; imports nothing optional."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, TypedDict


class ChatError(RuntimeError):
    """Every configured provider failed."""


class ChatUnavailable(RuntimeError):
    """No provider is configured."""


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    model: str
    api_key: str


class ChatMessage(TypedDict):
    role: str
    content: str


@dataclass(frozen=True)
class AskOptions:
    """What to ask about and how; every field is optional."""

    book: str | None = None
    page: int | None = None
    model: str | None = None
    allowed_books: set[str] | None = None
    scope: str | None = None
    mode: str | None = None
    effort: str | None = None


@dataclass(frozen=True)
class AskCallbacks:
    """Progress hooks called from the worker thread while an answer is produced."""

    on_step: Callable[[str], None] | None = None
    on_token: Callable[[str], None] | None = None
    on_thought: Callable[[str], None] | None = None
    #: Documents a tool just found (book/page/section/snippet dicts), once per tool call.
    on_found: Callable[[list[dict[str, object]]], None] | None = None


class ChatBackend(Protocol):
    """The slice of ChatService the HTTP layer depends on."""

    def available(self) -> bool: ...

    def providers(self) -> list[ProviderConfig]: ...

    def model_options(self) -> list[dict[str, str]]: ...

    def ask(
        self,
        messages: list[ChatMessage],
        options: AskOptions | None = None,
        callbacks: AskCallbacks | None = None,
    ) -> dict[str, object]: ...
