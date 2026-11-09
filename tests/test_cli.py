import os
import time
from pathlib import Path

import pytest

from book_reader.__main__ import _bundle_needs_build, ensure_frontend_bundle, load_env


def test_load_env_reads_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("BOOK_READER_TEST_KEY=abc\n", encoding="utf-8")
    monkeypatch.delenv("BOOK_READER_TEST_KEY", raising=False)
    assert load_env(tmp_path) is True
    assert os.environ["BOOK_READER_TEST_KEY"] == "abc"


def test_load_env_ignores_missing_file(tmp_path: Path) -> None:
    assert load_env(tmp_path) is False


def test_bundle_needs_build_detects_missing_and_stale_bundle(tmp_path: Path) -> None:
    frontend = tmp_path / "frontend"
    (frontend / "src").mkdir(parents=True)
    source = frontend / "src" / "main.tsx"
    source.write_text("export {};\n", encoding="utf-8")
    bundle_index = tmp_path / "static" / "app" / "index.html"

    # Missing bundle -> needs build
    assert _bundle_needs_build(frontend, bundle_index) is True

    # Up-to-date bundle -> does not need build
    bundle_index.parent.mkdir(parents=True)
    bundle_index.write_text("<!doctype html>", encoding="utf-8")
    now = time.time()
    os.utime(source, (now - 10, now - 10))
    os.utime(bundle_index, (now, now))
    assert _bundle_needs_build(frontend, bundle_index) is False

    # Newer source file -> needs build
    os.utime(source, (now + 10, now + 10))
    assert _bundle_needs_build(frontend, bundle_index) is True


def test_ensure_frontend_bundle_noop_when_not_source_checkout(tmp_path: Path) -> None:
    assert ensure_frontend_bundle(repo_root=tmp_path, static_dir=tmp_path / "static") is False
