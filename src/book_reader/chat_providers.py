"""Chat provider configuration resolved from the environment (no optional imports)."""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping

from .chat_types import ProviderConfig

logger = logging.getLogger(__name__)

DEFAULT_PRIORITY = (
    "inception:mercury-3,"
    "gemini:gemini-3.8-flash,"
    "mistral:mistral-small-latest,"
    "mistral:ministral-8b-latest,"
    "mistral:zai-glm-5-3-flash,"
    "openrouter:openrouter/free,"
    "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free,"
    "ollama:gpt-oss:20b"
)

PROVIDER_DEFAULTS: dict[str, tuple[str, str, str, str]] = {
    "mistral": (
        "https://api.mistral.ai/v1",
        "MISTRAL_API_KEY",
        "mistral-small-latest",
        "BOOK_READER_MISTRAL_MODEL",
    ),
    "inception": (
        "https://api.inceptionlabs.ai/v1",
        "INCEPTION_API_KEY",
        "mercury-3",
        "BOOK_READER_INCEPTION_MODEL",
    ),
    "openrouter": (
        "https://openrouter.ai/api/v1",
        "OPENROUTER_API_KEY",
        "openrouter/free",
        "BOOK_READER_OPENROUTER_MODEL",
    ),
    "ollama": (
        "https://ollama.com/v1",
        "OLLAMA_API_KEY",
        "gpt-oss:20b",
        "BOOK_READER_OLLAMA_MODEL",
    ),
    # Google's OpenAI-compatible endpoint.
    "gemini": (
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        "GEMINI_API_KEY",
        "gemini-3.8-flash",
        "BOOK_READER_GEMINI_MODEL",
    ),
}


PROVIDER_KEY_ENVS: dict[str, tuple[str, ...]] = {
    "mistral": ("MISTRAL_API_KEY", "MISTRAL_API"),
    "gemini": ("GEMINI_API_KEY", "GEMINI_API", "GOOGLE_API_KEY"),
}


def _provider_key(source: Mapping[str, str], name: str) -> str:
    env_names = PROVIDER_KEY_ENVS.get(name, (PROVIDER_DEFAULTS[name][1],))
    for env_name in env_names:
        value = source.get(env_name, "").strip()
        if value:
            return value
    return ""


def _priority_entries(source: Mapping[str, str]) -> list[str]:
    priority = source.get("BOOK_READER_CHAT_PRIORITY", "").strip()
    if priority:
        return [entry.strip() for entry in priority.split(",") if entry.strip()]
    legacy = source.get("BOOK_READER_CHAT_PROVIDERS", "").strip()
    if legacy:
        return [entry.strip() for entry in legacy.split(",") if entry.strip()]
    return DEFAULT_PRIORITY.split(",")


def resolve_providers(env: Mapping[str, str] | None = None) -> list[ProviderConfig]:
    """Provider/model attempts in preference order, skipping names without keys.

    ``BOOK_READER_CHAT_PRIORITY`` accepts ``provider[:model]`` entries; a bare
    provider name uses its default model.
    """
    source = env if env is not None else os.environ
    providers: list[ProviderConfig] = []
    for entry in _priority_entries(source):
        name, _separator, model_hint = entry.partition(":")
        name = name.strip().lower()
        defaults = PROVIDER_DEFAULTS.get(name)
        if defaults is None:
            logger.warning("unknown chat provider ignored: %s", name)
            continue
        base_url, _key_env, default_model, model_env = defaults
        api_key = _provider_key(source, name)
        if not api_key:
            continue
        model = model_hint.strip() or source.get(model_env, default_model)
        providers.append(
            ProviderConfig(
                name=name,
                base_url=source.get(f"BOOK_READER_{name.upper()}_BASE_URL", base_url),
                model=model,
                api_key=api_key,
            )
        )
    return providers
