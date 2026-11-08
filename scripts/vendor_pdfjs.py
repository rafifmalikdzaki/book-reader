#!/usr/bin/env python3
"""Vendor the pinned PDF.js viewer distribution used by the reader iframe."""

from __future__ import annotations

import io
import json
import gzip
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

VERSION = "6.5.438"
API_RELEASE = f"https://api.github.com/repos/mozilla/pdf.js/releases/tags/v{VERSION}"
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src" / "book_reader" / "static" / "vendor" / "pdfjs"
REQUIRED = ("build/pdf.mjs", "build/pdf.worker.mjs", "web/viewer.html", "web/viewer.mjs")


def current_version() -> str:
    try:
        return (TARGET / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _download(url: str, *, accept: str) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "book-reader-vendor"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()



def _compress_text(root: Path) -> None:
    suffixes = {".html", ".js", ".mjs", ".css", ".json", ".svg", ".ftl", ".map", ".txt"}
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in suffixes and not path.name.endswith(".gz"):
            path.with_name(path.name + ".gz").write_bytes(
                gzip.compress(path.read_bytes(), mtime=0)
            )


def main() -> None:
    if current_version() == VERSION and all((TARGET / name).is_file() for name in REQUIRED):
        _compress_text(TARGET)
        print(f"pdfjs {VERSION} already vendored")
        return
    print(f"resolving pdfjs {VERSION} dist release...")
    release = json.loads(_download(API_RELEASE, accept="application/vnd.github+json"))
    asset = next(
        (item for item in release.get("assets", []) if item.get("name") == f"pdfjs-{VERSION}-dist.zip"),
        None,
    )
    if asset is None:
        raise SystemExit("pdfjs dist asset not found")
    print(f"downloading {asset['name']}...")
    archive_bytes = _download(str(asset["url"]), accept="application/octet-stream")
    with tempfile.TemporaryDirectory(prefix="pdfjs-") as temp:
        archive = Path(temp) / "pdfjs.zip"
        archive.write_bytes(archive_bytes)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(temp)
        package = Path(temp)
        if TARGET.exists():
            shutil.rmtree(TARGET)
        TARGET.mkdir(parents=True)
        (TARGET / "build").mkdir(parents=True)
        for name in (package / "build").iterdir():
            if name.is_file() and name.suffix != ".map":
                shutil.copy2(name, TARGET / "build" / name.name)
        shutil.copytree(
            package / "web",
            TARGET / "web",
            ignore=shutil.ignore_patterns(
                "*.map",
                "compressed.tracemonkey-pldi-09.pdf",
                "debugger.css",
                "debugger.mjs",
            ),
        )
        license_path = package / "LICENSE"
        if license_path.is_file():
            shutil.copy2(license_path, TARGET / "LICENSE")
        (TARGET / "VERSION").write_text(VERSION + "\n", encoding="utf-8")
        _compress_text(TARGET)
    missing = [name for name in REQUIRED if not (TARGET / name).is_file()]
    if missing:
        raise SystemExit(f"pdfjs vendoring incomplete: {', '.join(missing)}")
    print(f"vendored pdfjs {VERSION} at {TARGET}")


if __name__ == "__main__":
    main()
