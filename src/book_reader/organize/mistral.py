"""Minimal JSON-mode client for the user's configured Mistral key."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


class JSONClient(Protocol):
    def json(self, system: str, user: str) -> dict[str, object] | None: ...


class MistralClient:
    """Minimal JSON-mode client for the user's configured Mistral key."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "mistral-small-latest",
        base_url: str = "https://api.mistral.ai/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    @classmethod
    def from_env(cls) -> MistralClient | None:
        key = (os.environ.get("MISTRAL_API_KEY") or os.environ.get("MISTRAL_API") or "").strip()
        if not key:
            return None
        return cls(
            key,
            model=os.environ.get("BOOK_READER_MISTRAL_MODEL", "mistral-small-latest"),
            base_url=os.environ.get("BOOK_READER_MISTRAL_BASE_URL", "https://api.mistral.ai/v1"),
        )

    def json(self, system: str, user: str) -> dict[str, object] | None:
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        for attempt in range(3):
            try:
                response = httpx.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                    timeout=90,
                )
                if response.status_code == 400 and "response_format" in response.text:
                    payload.pop("response_format", None)
                    response = httpx.post(
                        f"{self.base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                        timeout=90,
                    )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                return _decode_json(str(content))
            except Exception as exc:
                logger.warning("mistral organize attempt %d failed: %s", attempt + 1, exc)
                time.sleep(1.2 * (attempt + 1))
        return None


def _decode_json(content: str) -> dict[str, object] | None:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None
