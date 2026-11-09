"""Chat request limits and model selection shared by the HTTP routes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException

from .preferences import Preferences

if TYPE_CHECKING:
    from .chat import ChatService

logger = logging.getLogger(__name__)

CHAT_MAX_MESSAGES = 50
CHAT_MAX_MESSAGE_CHARS = 8000
CHAT_EFFORTS = frozenset({"default", "low", "medium", "high"})


def chat_model_ids(chat: ChatService) -> set[str]:
    return {option["id"] for option in chat.model_options()}


def select_model(explicit: str | None, preferences: Preferences, chat: ChatService) -> str:
    selected = explicit or preferences.get("chat_model", "auto") or "auto"
    if selected == "auto":
        return selected
    if selected in chat_model_ids(chat):
        return selected
    if explicit:
        raise HTTPException(status_code=400, detail=f"unknown model: {selected}")
    logger.warning("stored chat model %s is unavailable; using auto", selected)
    return "auto"
