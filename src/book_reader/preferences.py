"""Small persisted user preferences (string key/value)."""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)


class Preferences:
    """JSON-backed preferences written atomically to the state directory."""

    def __init__(self, state_dir: Path) -> None:
        self.path = Path(state_dir) / "preferences.json"
        self._lock = threading.RLock()
        self._values: dict[str, str] | None = None

    def _load(self) -> dict[str, str]:
        with self._lock:
            if self._values is None:
                self._values = self._read()
            return self._values

    def _read(self) -> dict[str, str]:
        try:
            raw: object = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("ignoring unreadable preferences %s: %s", self.path, exc)
            return {}
        values = raw.get("values") if isinstance(raw, dict) else None
        if not isinstance(values, dict):
            return {}
        return {str(key): str(value) for key, value in values.items()}

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._load().get(key, default)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            values = self._load()
            values[key] = value
            payload = {"version": 1, "values": values}
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_name(self.path.name + ".tmp")
                tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
                os.replace(tmp, self.path)
            except OSError as exc:
                logger.warning("cannot persist preferences to %s: %s", self.path, exc)
