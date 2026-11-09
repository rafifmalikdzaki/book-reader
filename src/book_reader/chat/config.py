"""Chat request limits and model selection; no HTTP types (the API layer maps the errors)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..state.preferences import Preferences

if TYPE_CHECKING:
    from .types import ChatBackend

logger = logging.getLogger(__name__)

CHAT_MAX_MESSAGES = 50
CHAT_MAX_MESSAGE_CHARS = 8000
CHAT_EFFORTS = frozenset({"default", "low", "medium", "high"})
# "default" sends no reasoning_effort at all. Providers that do not accept the parameter reject
# the request, so it is only sent once the user picks a level.
DEFAULT_CHAT_EFFORT = "default"


class UnknownModel(ValueError):
    """The requested ``provider:model`` is not configured."""


def chat_model_ids(chat: ChatBackend) -> set[str]:
    return {option["id"] for option in chat.model_options()}


def select_model(explicit: str | None, preferences: Preferences, chat: ChatBackend) -> str:
    selected = explicit or preferences.get("chat_model", "auto") or "auto"
    if selected == "auto":
        return selected
    if selected in chat_model_ids(chat):
        return selected
    if explicit:
        raise UnknownModel(f"unknown model: {selected}")
    logger.warning("stored chat model %s is unavailable; using auto", selected)
    return "auto"
