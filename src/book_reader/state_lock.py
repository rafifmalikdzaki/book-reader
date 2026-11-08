"""Process-level ownership of a state directory.

The server keeps progress, notes, and the reindex manifest in memory. A CLI
reindex running at the same time would migrate files on disk while the server
still held the old keys, and the server's next write would undo the migration.
An advisory file lock makes that impossible: one process owns the state at a
time. The lock is released by the kernel when the process exits, even if it
crashes.
"""

from __future__ import annotations

import os
from contextlib import suppress
from pathlib import Path
from typing import IO

try:  # POSIX; the app targets local Linux/macOS.
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None  # type: ignore[assignment]

LOCK_NAME = ".book-reader.lock"


class StateLockedError(RuntimeError):
    """Another process is using this state directory."""


class StateDirectoryLock:
    def __init__(self, state_dir: Path) -> None:
        self.path = Path(state_dir) / LOCK_NAME
        self._handle: IO[str] | None = None

    def acquire(self) -> None:
        if self._handle is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+", encoding="utf-8")
        if fcntl is not None:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                handle.seek(0)
                owner = handle.read().strip()
                handle.close()
                detail = f" (pid {owner})" if owner else ""
                raise StateLockedError(
                    f"the state directory is already in use{detail}; "
                    "stop the running reader before running a state-changing CLI command"
                ) from exc
            except OSError as exc:
                handle.close()
                raise StateLockedError(f"cannot lock the state directory: {exc}") from exc
        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()))
        handle.flush()
        self._handle = handle

    def release(self) -> None:
        handle = self._handle
        self._handle = None
        if handle is None:
            return
        if fcntl is not None:
            with suppress(OSError):
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()

    def __enter__(self) -> StateDirectoryLock:
        self.acquire()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()
