"""The React SPA shell: all HTML routes, moved-book redirects, caching and CSP."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from book_reader.app import create_app

SHELL_MARKER = "<!-- spa-shell-fixture -->"
ASSET = "main-4f9a1c.js"


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    """A fake packaged static folder holding a built bundle."""
    root = tmp_path / "static"
    (root / "app" / "assets").mkdir(parents=True)
    (root / "app" / "index.html").write_text(
        f"<!doctype html><html><body>{SHELL_MARKER}</body></html>", encoding="utf-8"
    )
    (root / "app" / "assets" / ASSET).write_text("export {};\n", encoding="utf-8")
    (root / "app" / "assets" / "chunk-77.mjs").write_text("export {};\n", encoding="utf-8")
    return root


@pytest.fixture
def react(library: Path, tmp_path: Path, static_dir: Path) -> Iterator[TestClient]:
    app = create_app(library, tmp_path / "state", static_dir=static_dir)
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/ask", "/design", "/book/sub/a.pdf", "/book/note.md"])
def test_react_mode_serves_the_shell_for_client_routes(react: TestClient, path: str) -> None:
    response = react.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert SHELL_MARKER in response.text


def test_react_mode_keeps_serving_json_and_raw_routes(react: TestClient) -> None:
    assert react.get("/healthz").json() == {"ok": True}
    assert react.get("/raw/sub/a.pdf").status_code == 200


def test_react_mode_redirects_moved_books_before_serving_the_shell(
    react: TestClient, library: Path
) -> None:
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")

    response = react.get("/book/sub/a.pdf?page=2", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].endswith("/book/shelf/moved.pdf?page=2")
    assert react.get("/book/shelf/moved.pdf").text.count(SHELL_MARKER) == 1


def test_react_mode_unknown_book_gets_the_shell_with_404(react: TestClient) -> None:
    response = react.get("/book/nope.pdf")
    assert response.status_code == 404
    assert SHELL_MARKER in response.text


def test_react_mode_invalid_book_uses_the_shell_status(react: TestClient) -> None:
    assert react.get("/book/..%2Fescape.pdf").status_code in {400, 404}
    assert react.get("/book/img.bin").status_code == 400
    assert SHELL_MARKER in react.get("/book/img.bin").text


def test_missing_bundle_returns_503_with_the_build_hint(library: Path, tmp_path: Path) -> None:
    empty_static = tmp_path / "empty-static"
    empty_static.mkdir()
    app = create_app(library, tmp_path / "state", static_dir=empty_static)
    with TestClient(app) as client:
        for path in ("/", "/ask", "/design", "/book/sub/a.pdf"):
            response = client.get(path)
            assert response.status_code == 503
            assert "scripts/build_frontend.sh" in response.text
            assert response.headers["cache-control"] == "no-store"


def test_hashed_bundle_assets_are_immutable_and_the_rest_revalidates(react: TestClient) -> None:
    asset = react.get(f"/static/app/assets/{ASSET}")
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert asset.headers["content-type"].startswith("text/javascript")

    module = react.get("/static/app/assets/chunk-77.mjs")
    assert module.headers["content-type"].startswith("text/javascript")

    assert react.get("/static/app/index.html").headers["cache-control"] == "no-cache"


def test_missing_hashed_asset_is_not_cached_as_immutable(react: TestClient) -> None:
    response = react.get("/static/app/assets/gone-123.js")
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-cache"


CSP = "Content-Security-Policy-Report-Only"


@pytest.mark.parametrize("path", ["/", "/ask", "/design", "/book/sub/a.pdf", "/book/nope.pdf"])
def test_react_html_responses_carry_a_report_only_csp(react: TestClient, path: str) -> None:
    policy = react.get(path).headers[CSP]
    directives = {part.split()[0]: part.split()[1:] for part in policy.split("; ")}
    assert directives["script-src"] == ["'self'"]
    assert directives["object-src"] == ["'none'"]
    assert "'self'" in directives["frame-src"]
    assert "Content-Security-Policy" not in react.get(path).headers


def test_missing_bundle_page_is_also_covered(library: Path, tmp_path: Path) -> None:
    empty_static = tmp_path / "empty-static"
    empty_static.mkdir()
    app = create_app(library, tmp_path / "state", static_dir=empty_static)
    with TestClient(app) as client:
        assert CSP in client.get("/").headers


@pytest.mark.parametrize(
    "path",
    [
        "/api/library",
        "/healthz",
        "/raw/sub/a.pdf",
        "/thumb.jpg?path=sub/a.pdf&width=240",
        f"/static/app/assets/{ASSET}",
        "/static/app/index.html",
    ],
)
def test_csp_is_not_added_to_json_static_or_raw_responses(react: TestClient, path: str) -> None:
    assert CSP not in react.get(path).headers


def test_csp_is_not_added_to_the_vendored_pdfjs_viewer(library: Path, tmp_path: Path) -> None:
    app = create_app(library, tmp_path / "state")
    with TestClient(app) as client:
        viewer = client.get("/static/vendor/pdfjs/web/viewer.html")
        assert viewer.status_code == 200
        assert CSP not in viewer.headers


def test_gzip_static_cannot_escape_the_bundle(
    react: TestClient, static_dir: Path, tmp_path: Path
) -> None:
    import gzip

    outside = tmp_path / "outside.gz"
    outside.write_bytes(gzip.compress(b"outside-secret"))
    response = react.get(
        "/static/..%2Foutside.gz",
        headers={"accept-encoding": "gzip"},
    )
    assert response.status_code == 404
    assert b"outside-secret" not in response.content
