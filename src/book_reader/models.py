"""Registry of the chat models the app knows about (no optional imports).

``models.json`` records what was measured about each ``provider:model`` id: whether it accepts
``reasoning_effort`` and which OpenUI block format it follows reliably. Unknown ids fall back to
the defaults, so any model named in ``BOOK_READER_CHAT_PRIORITY`` still works.
"""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass, field
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parent / "models.json"
OPENUI_FORMATS = ("json", "lang")
# `lang` (OpenUI Lang) is opt-in per model: most models wrote keyword arguments instead of the
# positional ones it requires (docs/decisions/ADR-008-openui-native.md).
DEFAULT_OPENUI_FORMAT = "json"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
    reasoning_effort: bool | None = None
    openui_format: str = DEFAULT_OPENUI_FORMAT
    eval: dict[str, str] = field(default_factory=dict)
    notes: str = ""

    @property
    def known(self) -> bool:
        return self.id in _registry()


@functools.lru_cache(maxsize=1)
def _registry() -> dict[str, ModelInfo]:
    raw = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))["models"]
    return {
        model_id: ModelInfo(
            id=model_id,
            label=str(entry["label"]),
            reasoning_effort=entry.get("reasoning_effort"),
            openui_format=str(entry.get("openui_format", DEFAULT_OPENUI_FORMAT)),
            eval=dict(entry.get("eval", {})),
            notes=str(entry.get("notes", "")),
        )
        for model_id, entry in raw.items()
    }


def model_info(model_id: str) -> ModelInfo:
    """Registry entry for ``provider:model``, or defaults labelled by the bare model name."""
    known = _registry().get(model_id)
    if known is not None:
        return known
    return ModelInfo(id=model_id, label=model_id.partition(":")[2] or model_id)


def registered_models() -> list[ModelInfo]:
    return list(_registry().values())
