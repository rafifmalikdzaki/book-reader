from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from book_reader.api.security import allowed_hosts_for
from book_reader.app import create_app

Client = tuple[TestClient, Path]


@pytest.mark.parametrize(
    "url",
    [
        "/raw/.hidden/secret.md",
        "/api/book?path=.hidden/secret.md",
        "/api/book/markdown?path=.hidden/secret.md",
        "/api/progress?path=.hidden/secret.md",
        "/api/book?path=sub/../.hidden/secret.md",
    ],
)
def test_hidden_directories_are_not_reachable_by_direct_path(client: Client, url: str) -> None:
    test_client, _state = client
    assert test_client.get(url).status_code == 404


def test_hidden_files_are_blocked_on_raw_unless_they_are_books(
    client: Client, library: Path
) -> None:
    test_client, _state = client
    (library / ".env").write_text("SECRET=1", encoding="utf-8")
    (library / ".draft.md").write_text("# draft", encoding="utf-8")
    assert test_client.get("/raw/.env").status_code == 404
    # The scan lists hidden-named books, so they must stay openable.
    assert test_client.get("/raw/.draft.md").status_code == 200
    assert test_client.get("/api/book/markdown?path=.draft.md").status_code == 200


def test_missing_vendor_files_are_not_cached_as_immutable(client: Client) -> None:
    test_client, _state = client
    missing = test_client.get("/static/vendor/does-not-exist.js")
    assert missing.status_code == 404
    assert "immutable" not in missing.headers["cache-control"]


def test_allowed_hosts_policy() -> None:
    assert allowed_hosts_for("127.0.0.1") == ("localhost", "127.0.0.1", "::1")
    assert allowed_hosts_for("0.0.0.0") is None
    assert allowed_hosts_for("0.0.0.0", "reader.lan, localhost") == ("reader.lan", "localhost")


@pytest.mark.parametrize(
    ("host", "status"),
    [
        ("localhost:8000", 200),
        ("LOCALHOST", 200),
        ("127.0.0.1:8000", 200),
        ("[::1]:8000", 200),
        ("evil.example", 400),
        ("evil.example:8000", 400),
        ("localhost.evil.example", 400),
        ("", 400),
    ],
)
def test_host_header_is_checked_on_loopback_binds(
    library: Path, tmp_path: Path, host: str, status: int
) -> None:
    app = create_app(library, tmp_path / "state", allowed_hosts=allowed_hosts_for("127.0.0.1"))
    with TestClient(app) as test_client:
        assert test_client.get("/healthz", headers={"host": host}).status_code == status


def test_host_header_is_unchecked_without_a_policy(library: Path, tmp_path: Path) -> None:
    with TestClient(create_app(library, tmp_path / "state")) as test_client:
        assert test_client.get("/healthz", headers={"host": "anything.example"}).status_code == 200
