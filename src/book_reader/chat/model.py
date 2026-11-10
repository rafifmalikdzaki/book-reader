"""Model construction and message-text helpers."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from .types import ProviderConfig

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


# Gemini 3 rejects replayed function calls that lack a thought signature, and LangChain drops the
# one Gemini returns. Google documents this value as the way to skip validation for such turns.
_GEMINI_SKIP_SIGNATURE = "skip_thought_signature_validator"


class GeminiChatOpenAI(ChatOpenAI):
    """ChatOpenAI that adds the signature Gemini requires on replayed tool calls."""

    def _get_request_payload(
        self, input_: Any, *, stop: list[str] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        payload: dict[str, Any] = super()._get_request_payload(input_, stop=stop, **kwargs)
        for message in payload.get("messages", []):
            for call in message.get("tool_calls") or []:
                call.setdefault(
                    "extra_content", {"google": {"thought_signature": _GEMINI_SKIP_SIGNATURE}}
                )
        return payload


def _chat_model(provider: ProviderConfig, effort: str | None = None) -> ChatOpenAI:
    kwargs: dict[str, Any] = {
        "model": provider.model,
        "api_key": SecretStr(provider.api_key),
        "base_url": provider.base_url,
        "temperature": 0.1,
        "timeout": 120,
        "max_retries": 0,
    }
    if effort in {"low", "medium", "high"}:
        kwargs["reasoning_effort"] = effort
    if provider.name == "gemini":
        return GeminiChatOpenAI(**kwargs)
    return ChatOpenAI(**kwargs)


def provider_key(provider: ProviderConfig) -> str:
    return f"{provider.name}:{provider.model}"


def _rejects_reasoning_effort(exc: Exception) -> bool:
    """True when a provider refused the request because it does not accept reasoning_effort."""
    return "reasoning_effort" in str(exc)


def _chunk_text(content: object) -> str:
    """Extract raw streaming text delta without stripping leading/trailing spaces."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def _message_text(content: object) -> str:
    """Flatten LangChain content (string or content blocks) to plain text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return " ".join(parts).strip()
    return str(content).strip()


def _extractive_answer(sources: list[dict[str, object]]) -> str:
    """Deterministic answer when the model returns no text: quote the best evidence."""
    lines = []
    for source in sources[:3]:
        book = str(source.get("book") or "")
        page = source.get("page")
        line = source.get("line")
        snippet = " ".join(str(source.get("snippet") or "").split())
        locator = f"{book}#p{page}" if page else f"{book}#L{line}" if line else book
        lines.append(f"- {locator}: {snippet}" if snippet else f"- {locator}")
    return "Relevant passages found:\n" + "\n".join(lines)


def _tool_error(message: str, **extra: object) -> str:
    """Uniform JSON error payload for tool results."""
    return json.dumps({"error": message, **extra})
