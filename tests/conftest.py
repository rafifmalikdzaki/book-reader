from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from book_reader.app import create_app

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "library"
    (root / "sub").mkdir(parents=True)
    (root / ".hidden").mkdir()

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "hello-search-needle")
    doc.new_page()
    doc.new_page()
    doc.save(root / "sub" / "a.pdf")
    doc.close()

    (root / "note.md").write_text(
        "# Title\n\nsee [a](sub/a.pdf)\n\n![pic](sub/pic%20one.png)\n\n"
        "```python\nprint(1)\n```\n\nUse snake_case names.\n",
        encoding="utf-8",
    )
    (root / "sub" / "pic one.png").write_bytes(PNG_MAGIC + b"\x00")
    (root / ".hidden" / "secret.md").write_text("# secret", encoding="utf-8")
    (root / "img.bin").write_bytes(b"\x00\x01")
    return root


@pytest.fixture
def client(library: Path, tmp_path: Path) -> Iterator[tuple[TestClient, Path]]:
    state = tmp_path / "state"
    with TestClient(create_app(library, state)) as test_client:
        yield test_client, state
