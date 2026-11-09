"""HTTP routes for persistent Ask sessions, chat projects, and scoped RAG messages."""

from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .chat_config import CHAT_MAX_MESSAGE_CHARS, select_model
from .chats import (
    _UNSET,
    RETENTION_DAYS,
    ChatProject,
    ChatSession,
    ChatStorageError,
    ChatStore,
    _Unset,
)
from .chats import (
    ChatError as ChatStoreError,
)
from .library import Library
from .organize import CategoryStore
from .preferences import Preferences
from .reconcile import LibraryReconciler

if TYPE_CHECKING:
    from .chat import ChatMessage, ChatService


class SessionCreate(BaseModel):
    book: str | None = None
    page: int | None = Field(default=None, ge=1)
    categories: list[str] | None = None


class SessionPatch(BaseModel):
    title: str | None = None
    pinned: bool | None = None
    project_id: str | None = None
    categories: list[str] | None = None


class MessageBody(BaseModel):
    content: str
    mode: str | None = None
    model: str | None = None
    effort: str | None = None


class ProjectBody(BaseModel):
    name: str


class SessionTaskHub:
    """Coordinates background research tasks and SSE subscribers per chat session."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}

    def is_running(self, session_id: str) -> bool:
        task = self._tasks.get(session_id)
        return task is not None and not task.done()

    def register_task(self, session_id: str, task: asyncio.Task[Any]) -> None:
        self._tasks[session_id] = task

    def cancel_task(self, session_id: str) -> bool:
        task = self._tasks.get(session_id)
        if task is not None and not task.done():
            task.cancel()
            return True
        return False

    def subscribe(self, session_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.setdefault(session_id, set()).add(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        if session_id in self._subscribers:
            self._subscribers[session_id].discard(queue)
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]

    def emit(self, session_id: str, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers.get(session_id, ())):
            queue.put_nowait(event)


def register(
    app: FastAPI,
    *,
    chats: ChatStore,
    library: Library,
    categories: CategoryStore,
    chat: ChatService | None,
    preferences: Preferences,
    reconciler: LibraryReconciler,
) -> None:
    """Attach Ask session routes; dependencies are injected by the app factory."""
    router = APIRouter(prefix="/api/chat", tags=["chat"])
    hub = SessionTaskHub()

    def session_or_404(session_id: str) -> ChatSession:
        session = chats.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="chat session not found")
        return session

    def validate_categories(raw: list[str]) -> list[str]:
        known = {item["id"] for item in categories.taxonomy()}
        selected: list[str] = []
        for value in raw:
            category_id = value.strip()
            if category_id not in known:
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown category: {category_id or value}",
                )
            if category_id not in selected:
                selected.append(category_id)
        return selected

    def resolve_book(rel: str) -> str:
        """Validate a book path, following a recorded rename when it moved."""
        current = reconciler.resolve(rel)
        if current != rel and library.find_book(current) is not None:
            return current
        library.book_file(rel)
        return rel

    def allowed_books(selected: list[str]) -> set[str] | None:
        if not selected:
            return None
        chosen = set(selected)
        assignments = categories.assignments()
        allowed: set[str] = set()
        for book in library.scan():
            content_id = reconciler.content_id(book.rel)
            if content_id is None:
                continue
            assignment = assignments.get(content_id)
            if assignment is not None and assignment["category"] in chosen:
                allowed.add(book.rel)
        return allowed

    def scope_label(selected: list[str]) -> str | None:
        if not selected:
            return None
        chosen = set(selected)
        taxonomy = categories.taxonomy()
        labels = [item["name"] for item in taxonomy if item["id"] in chosen]
        known = {item["id"] for item in taxonomy}
        labels.extend(item for item in selected if item not in known)
        return "categories: " + ", ".join(labels)

    def store_error(exc: Exception) -> HTTPException:
        if isinstance(exc, ChatStorageError):
            return HTTPException(status_code=500, detail=str(exc))
        return HTTPException(status_code=400, detail=str(exc))

    @router.get("/sessions")
    def list_sessions() -> dict[str, object]:
        try:
            sessions = chats.list_sessions()
            projects = chats.list_projects()
        except (ChatStorageError, ChatStoreError) as exc:
            raise store_error(exc) from exc
        return {
            "retention_days": RETENTION_DAYS,
            "categories": categories.taxonomy(),
            "projects": projects,
            "sessions": sessions,
        }

    @router.post("/sessions", status_code=201)
    def create_session(body: SessionCreate) -> ChatSession:
        book = resolve_book(body.book) if body.book is not None else None
        selected = validate_categories(body.categories or [])
        try:
            return chats.create_session(book=book, page=body.page, categories=selected)
        except (ChatStorageError, ChatStoreError) as exc:
            raise store_error(exc) from exc

    @router.get("/sessions/{session_id}")
    def get_session(session_id: str) -> ChatSession:
        return session_or_404(session_id)

    @router.patch("/sessions/{session_id}")
    def update_session(session_id: str, body: SessionPatch) -> ChatSession:
        session_or_404(session_id)
        fields = body.model_fields_set
        if not fields:
            raise HTTPException(status_code=400, detail="nothing to update")
        if "title" in fields and body.title is None:
            raise HTTPException(status_code=400, detail="title must be a string")
        if "pinned" in fields and body.pinned is None:
            raise HTTPException(status_code=400, detail="pinned must be a boolean")
        project_id: str | _Unset | None = _UNSET
        if "project_id" in fields:
            project_id = body.project_id
        selected: list[str] | _Unset = _UNSET
        if "categories" in fields:
            if body.categories is None:
                raise HTTPException(status_code=400, detail="categories must be a list")
            selected = validate_categories(body.categories)
        try:
            return chats.update_session(
                session_id,
                title=body.title,
                pinned=body.pinned,
                project_id=project_id,
                categories=selected,
            )
        except (ChatStorageError, ChatStoreError) as exc:
            raise store_error(exc) from exc

    @router.delete("/sessions/{session_id}")
    def delete_session(session_id: str) -> dict[str, bool]:
        try:
            chats.delete_session(session_id)
        except ChatStoreError as exc:
            raise HTTPException(status_code=404, detail="chat session not found") from exc
        except ChatStorageError as exc:
            raise store_error(exc) from exc
        return {"ok": True}

    @router.get("/projects")
    def list_projects() -> dict[str, object]:
        try:
            return {"projects": chats.list_projects()}
        except ChatStorageError as exc:
            raise store_error(exc) from exc

    @router.post("/projects", status_code=201)
    def create_project(body: ProjectBody) -> ChatProject:
        try:
            return chats.create_project(body.name)
        except (ChatStorageError, ChatStoreError) as exc:
            raise store_error(exc) from exc

    @router.delete("/projects/{project_id}")
    def delete_project(project_id: str) -> dict[str, bool]:
        try:
            chats.delete_project(project_id)
        except (ChatStorageError, ChatStoreError) as exc:
            raise store_error(exc) from exc
        return {"ok": True}

    @router.get("/sessions/{session_id}/events")
    async def session_events(session_id: str) -> StreamingResponse:
        session = session_or_404(session_id)
        queue = hub.subscribe(session_id)

        async def generator() -> AsyncIterator[str]:
            try:
                initial = {
                    "type": "status",
                    "status": session.get("status", "idle"),
                    "step": session.get("thought_step", ""),
                }
                yield f"data: {json.dumps(initial)}\n\n"
                if session.get("status") != "thinking" and not hub.is_running(session_id):
                    return

                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15.0)
                        yield f"data: {json.dumps(event)}\n\n"
                        if event.get("type") in {"done", "error"}:
                            break
                    except TimeoutError:
                        yield ": ping\n\n"
            finally:
                hub.unsubscribe(session_id, queue)

        return StreamingResponse(
            generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/sessions/{session_id}/messages")
    async def post_message(session_id: str, body: MessageBody) -> dict[str, object]:
        session = session_or_404(session_id)
        if session.get("status") == "thinking" or hub.is_running(session_id):
            raise HTTPException(
                status_code=409, detail="chat session is already generating a response"
            )

        content = body.content.strip()
        if not content:
            raise HTTPException(status_code=400, detail="message content must not be empty")
        if len(content) > CHAT_MAX_MESSAGE_CHARS:
            raise HTTPException(
                status_code=400,
                detail=f"message must be at most {CHAT_MAX_MESSAGE_CHARS} characters",
            )
        if chat is None:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra and set a provider key",
            )
        try:
            from .chat import ChatError as ProviderChatError
            from .chat import ChatUnavailable
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="chat is not configured; install the agent extra",
            ) from exc

        book = session["book"]
        if book is not None:
            current = reconciler.resolve(book)
            if current != book and library.find_book(current) is not None:
                try:
                    session = chats.update_session(session_id, book=current)
                except ChatStoreError as exc:
                    raise HTTPException(status_code=404, detail="chat session not found") from exc
                except ChatStorageError as exc:
                    raise store_error(exc) from exc
                book = current

        try:
            chats.add_message(session_id, "user", content)
        except ChatStorageError as exc:
            raise store_error(exc) from exc
        except ChatStoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        stored = session_or_404(session_id)
        known_categories = {item["id"] for item in categories.taxonomy()}
        selected = [item for item in stored["categories"] if item in known_categories]
        if selected != stored["categories"]:
            try:
                stored = chats.update_session(session_id, categories=selected)
            except (ChatStorageError, ChatStoreError) as exc:
                raise store_error(exc) from exc
        history: list[ChatMessage] = [
            {"role": message["role"], "content": message["content"]}
            for message in stored["messages"][-50:]
        ]
        allowed = allowed_books(selected)
        book_in_scope = allowed is None or (book is not None and book in allowed)

        loop = asyncio.get_running_loop()

        def background_work() -> dict[str, object]:
            steps_recorded: list[str] = []
            t_start = time.perf_counter()

            def on_step(step: str) -> None:
                clean = step.strip()
                if clean and (not steps_recorded or steps_recorded[-1] != clean):
                    steps_recorded.append(clean)
                elapsed = round(time.perf_counter() - t_start, 1)
                chats.set_session_status(session_id, "thinking", thought_step=clean)
                loop.call_soon_threadsafe(
                    hub.emit,
                    session_id,
                    {
                        "type": "step",
                        "step": clean,
                        "steps": list(steps_recorded),
                        "elapsed": elapsed,
                    },
                )

            def on_thought(delta: str) -> None:
                loop.call_soon_threadsafe(hub.emit, session_id, {"type": "thought", "delta": delta})

            def on_token(delta: str) -> None:
                loop.call_soon_threadsafe(hub.emit, session_id, {"type": "delta", "delta": delta})

            chats.set_session_status(session_id, "thinking", thought_step="Searching library…")
            on_step("Searching library…")

            try:
                selected_model = select_model(body.model, preferences, chat)
                selected_effort = body.effort or preferences.get("chat_effort", "medium")
                ask_kwargs: dict[str, Any] = {
                    "book": book if book_in_scope else None,
                    "page": stored["page"] if book_in_scope else None,
                    "model": selected_model,
                    "allowed_books": allowed,
                    "scope": scope_label(selected),
                }
                ask_sig = inspect.signature(chat.ask)
                accepts_var_kw = any(p.kind == p.VAR_KEYWORD for p in ask_sig.parameters.values())
                if "on_step" in ask_sig.parameters or accepts_var_kw:
                    ask_kwargs["on_step"] = on_step
                if "on_token" in ask_sig.parameters or accepts_var_kw:
                    ask_kwargs["on_token"] = on_token
                if "on_thought" in ask_sig.parameters or accepts_var_kw:
                    ask_kwargs["on_thought"] = on_thought
                if body.mode and ("mode" in ask_sig.parameters or accepts_var_kw):
                    ask_kwargs["mode"] = body.mode
                if "effort" in ask_sig.parameters or accepts_var_kw:
                    ask_kwargs["effort"] = selected_effort
                result = chat.ask(history, **ask_kwargs)
            except Exception as exc:
                chats.set_session_status(session_id, "error", thought_step="", last_error=str(exc))
                loop.call_soon_threadsafe(
                    hub.emit, session_id, {"type": "error", "error": str(exc)}
                )
                raise

            answer = str(result.get("answer") or "").strip()
            if not answer:
                empty_err = HTTPException(
                    status_code=502, detail="chat provider returned an empty answer"
                )
                chats.set_session_status(
                    session_id, "error", thought_step="", last_error=str(empty_err.detail)
                )
                loop.call_soon_threadsafe(
                    hub.emit, session_id, {"type": "error", "error": empty_err.detail}
                )
                raise empty_err
            answer = answer[:CHAT_MAX_MESSAGE_CHARS]
            raw_sources = result.get("sources")
            sources: list[dict[str, object]] = (
                [dict(item) for item in raw_sources if isinstance(item, dict)]
                if isinstance(raw_sources, list)
                else []
            )
            # Combine steps from result if provided
            final_steps = list(steps_recorded)
            raw_thought_steps = result.get("thought_steps")
            if isinstance(raw_thought_steps, list):
                for s in raw_thought_steps:
                    if isinstance(s, str) and s and s not in final_steps:
                        final_steps.append(s)
            try:
                chats.add_message(
                    session_id,
                    "assistant",
                    answer,
                    sources=sources,
                    provider=str(result.get("provider") or ""),
                    model=str(result.get("model") or ""),
                    thought_steps=final_steps,
                )
            except (ChatStorageError, ChatStoreError) as exc:
                chats.set_session_status(session_id, "error", thought_step="", last_error=str(exc))
                loop.call_soon_threadsafe(
                    hub.emit, session_id, {"type": "error", "error": str(exc)}
                )
                raise store_error(exc) from exc

            final_session = session_or_404(session_id)
            loop.call_soon_threadsafe(
                hub.emit, session_id, {"type": "done", "session": final_session}
            )
            return {"session": final_session}

        task = asyncio.create_task(asyncio.to_thread(background_work))
        hub.register_task(session_id, task)
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError as exc:
            chats.set_session_status(session_id, "idle", thought_step="")
            raise HTTPException(status_code=499, detail="generation cancelled") from exc
        except ChatUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ProviderChatError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except ChatStorageError as exc:
            raise store_error(exc) from exc

    @router.post("/sessions/{session_id}/cancel")
    def cancel_session(session_id: str) -> dict[str, object]:
        session_or_404(session_id)
        cancelled = hub.cancel_task(session_id)
        updated = chats.set_session_status(session_id, "idle", thought_step="")
        hub.emit(session_id, {"type": "done", "session": updated})
        return {"ok": True, "cancelled": cancelled, "session": updated}

    app.include_router(router)
