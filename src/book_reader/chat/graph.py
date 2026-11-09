"""LangGraph agent loop with streaming and reasoning-effort fallback."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from .limits import MAX_TOOL_ROUNDS
from .model import _chat_model, _chunk_text, _rejects_reasoning_effort, provider_key
from .state import ServiceState
from .types import ProviderConfig

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class GraphMixin(ServiceState):
    """The LangGraph agent loop."""

    def _graph(
        self,
        bound: Runnable[Any, AIMessage],
        plain: Runnable[Any, AIMessage],
        tools: list[BaseTool],
        *,
        on_step: Callable[[str], None] | None = None,
        on_token: Callable[[str], None] | None = None,
        on_thought: Callable[[str], None] | None = None,
        provider: ProviderConfig | None = None,
    ) -> Any:
        def tool_rounds(state: MessagesState) -> int:
            return sum(
                1
                for message in state["messages"]
                if isinstance(message, AIMessage) and message.tool_calls
            )

        def stream_or_invoke(
            runnable: Runnable[Any, AIMessage], msgs: Sequence[BaseMessage]
        ) -> AIMessage:
            if on_token is None and on_thought is None:
                return runnable.invoke(msgs)
            try:
                accumulated: Any = None
                for chunk in runnable.stream(msgs):
                    accumulated = chunk if accumulated is None else accumulated + chunk
                    rc = chunk.additional_kwargs.get("reasoning_content") or getattr(
                        chunk, "reasoning_content", None
                    )
                    if rc and on_thought:
                        on_thought(str(rc))
                    has_tools = bool(
                        getattr(chunk, "tool_calls", None)
                        or getattr(chunk, "tool_call_chunks", None)
                        or getattr(accumulated, "tool_calls", None)
                        or getattr(accumulated, "tool_call_chunks", None)
                    )
                    if not has_tools:
                        delta = _chunk_text(getattr(chunk, "content", ""))
                        if delta and on_token:
                            on_token(delta)
                if isinstance(accumulated, AIMessage):
                    return accumulated
            except Exception as exc:
                if _rejects_reasoning_effort(exc):
                    raise
            return runnable.invoke(msgs)

        def invoke_model(
            runnable: Runnable[Any, AIMessage], msgs: Sequence[BaseMessage]
        ) -> AIMessage:
            try:
                return stream_or_invoke(runnable, msgs)
            except Exception as exc:
                if provider is None or not _rejects_reasoning_effort(exc):
                    raise
                self._effort_rejected.add(provider_key(provider))
            plain = _chat_model(provider)
            return (plain.bind_tools(tools) if runnable is bound else plain).invoke(msgs)

        def agent_node(state: MessagesState) -> dict[str, list[BaseMessage]]:
            if on_step:
                on_step("Reasoning about next step…")
            return {"messages": [invoke_model(bound, state["messages"])]}

        def finish_node(state: MessagesState) -> dict[str, list[BaseMessage]]:
            if on_step:
                on_step("Synthesizing teaching response from retrieved sources…")
            evidence = [
                str(message.content)[:2500]
                for message in state["messages"]
                if isinstance(message, ToolMessage) and not str(message.content).startswith("Error")
            ]
            question = ""
            for message in reversed(state["messages"]):
                if isinstance(message, HumanMessage):
                    question = str(message.content)
                    break
            prompt = SystemMessage(
                content=(
                    "Answer the user's question thoroughly as a patient teacher using this "
                    "evidence. Cite book#p12 or book#L40 when you use a passage, and include an "
                    "```openui component block if it clarifies the explanation.\n\nEVIDENCE:\n"
                    + "\n---\n".join(evidence[-6:] or ["(no tool evidence)"])
                )
            )
            return {"messages": [invoke_model(plain, [prompt, HumanMessage(content=question)])]}

        def route(state: MessagesState) -> str:
            if tool_rounds(state) >= MAX_TOOL_ROUNDS:
                return "finish"
            last = state["messages"][-1]
            if isinstance(last, AIMessage) and last.tool_calls:
                return "tools"
            return END

        def after_tools(state: MessagesState) -> str:
            last = state["messages"][-1]
            if isinstance(last, ToolMessage) and str(last.content).startswith("Error"):
                return "finish"
            return "agent"

        builder = StateGraph(MessagesState)
        builder.add_node("agent", agent_node)
        builder.add_node("tools", ToolNode(tools))
        builder.add_node("finish", finish_node)
        builder.add_edge(START, "agent")
        builder.add_conditional_edges(
            "agent", route, {"tools": "tools", "finish": "finish", END: END}
        )
        builder.add_conditional_edges("tools", after_tools, {"agent": "agent", "finish": "finish"})
        builder.add_edge("finish", END)
        return builder.compile()
