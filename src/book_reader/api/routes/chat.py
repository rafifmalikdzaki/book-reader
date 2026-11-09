"""Stateless chat: provider status, model/effort options, and POST /api/chat."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ...chat.config import (
    CHAT_EFFORTS,
    CHAT_MAX_MESSAGE_CHARS,
    CHAT_MAX_MESSAGES,
    DEFAULT_CHAT_EFFORT,
    chat_model_ids,
    select_model,
)
from ...chat.types import AskOptions, ChatBackend, ChatError, ChatMessage, ChatUnavailable
from ...library.scan import Library
from ...state.preferences import Preferences


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


def register(
    app: FastAPI,
    *,
    chat: ChatBackend | None,
    library: Library,
    preferences: Preferences,
) -> None:
    """Attach the stateless chat routes (sessions live in chat_sessions)."""

    @app.get("/api/chat/status")
    def api_chat_status() -> dict[str, object]:
        selected = preferences.get("chat_model", "auto")
        if chat is None:
            return {
                "available": False,
                "providers": [],
                "reason": "agent extra not installed",
                "selected": selected,
            }
        return {
            "available": chat.available(),
            "providers": chat.model_options(),
            "selected": selected,
        }

    @app.get("/api/chat/options")
    def api_chat_options() -> dict[str, object]:
        if chat is None:
            return {
                "available": False,
                "models": [],
                "selected": "auto",
                "effort": DEFAULT_CHAT_EFFORT,
            }
        return {
            "available": chat.available(),
            "models": chat.model_options(),
            "selected": preferences.get("chat_model", "auto"),
            "effort": preferences.get("chat_effort", DEFAULT_CHAT_EFFORT),
        }

    @app.post("/api/chat/options")
    def api_chat_options_save(choice: ModelChoice) -> dict[str, object]:
        model: str | None = None
        if choice.model is not None:
            model = choice.model.strip() or "auto"
            if model != "auto":
                if chat is None:
                    raise HTTPException(status_code=503, detail="chat is not configured")
                if model not in chat_model_ids(chat):
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
        if chat is None:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra and set a provider key",
            )
        messages = _chat_messages(body.messages)
        if body.book is not None:
            library.book_file(body.book)
        selected = select_model(body.model, preferences, chat)
        selected_effort = body.effort or preferences.get("chat_effort", DEFAULT_CHAT_EFFORT)
        try:
            options = AskOptions(
                book=body.book,
                page=body.page,
                model=selected,
                mode=body.mode or None,
                effort=selected_effort,
            )
            return chat.ask(messages, options)
        except ChatUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ChatError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
