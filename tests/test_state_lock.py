"""One process owns a state directory at a time."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.state_lock import StateDirectoryLock, StateLockedError


def test_lock_is_exclusive(tmp_path: Path) -> None:
    first = StateDirectoryLock(tmp_path)
    second = StateDirectoryLock(tmp_path)
    first.acquire()
    try:
        with pytest.raises(StateLockedError):
            second.acquire()
    finally:
        first.release()

    second.acquire()
    second.release()


def test_reindex_cli_refuses_while_the_server_owns_state(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    app = create_app(library, state)
    try:
        with TestClient(app):
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "book_reader",
                    "--reindex",
                    "--library",
                    str(library),
                    "--state-dir",
                    str(state),
                ],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True,
                text=True,
                timeout=30,
            )
    finally:
        app.state.state_dir_lock.release()

    assert result.returncode == 2
    assert "already in use" in result.stderr
