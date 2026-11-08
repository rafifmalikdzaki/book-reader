import os
from pathlib import Path

import pytest

from book_reader.__main__ import load_env


def test_load_env_reads_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("BOOK_READER_TEST_KEY=abc\n", encoding="utf-8")
    monkeypatch.delenv("BOOK_READER_TEST_KEY", raising=False)
    assert load_env(tmp_path) is True
    assert os.environ["BOOK_READER_TEST_KEY"] == "abc"


def test_load_env_ignores_missing_file(tmp_path: Path) -> None:
    assert load_env(tmp_path) is False
