#!/usr/bin/env python3
"""Vendor the pinned KaTeX runtime used by the chat renderer."""

from __future__ import annotations

import gzip
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

VERSION = "0.19.1"
TARBALL = f"https://registry.npmjs.org/katex/-/katex-{VERSION}.tgz"
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src" / "book_reader" / "static" / "vendor" / "katex"
REQUIRED = ("katex.min.css", "katex.min.js", "contrib/auto-render.min.js", "fonts/KaTeX_Main-Regular.woff2")


def current_version() -> str:
    try:
        return (TARGET / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return ""



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
        print(f"katex {VERSION} already vendored")
        return
    with tempfile.TemporaryDirectory(prefix="katex-") as temp:
        archive = Path(temp) / "katex.tgz"
        print(f"downloading katex {VERSION}...")
        urllib.request.urlretrieve(TARBALL, archive)
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(temp, filter="data")
        dist = Path(temp) / "package" / "dist"
        if TARGET.exists():
            shutil.rmtree(TARGET)
        TARGET.mkdir(parents=True)
        for name in ("katex.min.css", "katex.min.js"):
            shutil.copy2(dist / name, TARGET / name)
        (TARGET / "contrib").mkdir()
        shutil.copy2(dist / "contrib" / "auto-render.min.js", TARGET / "contrib" / "auto-render.min.js")
        shutil.copytree(dist / "fonts", TARGET / "fonts")
        license_path = Path(temp) / "package" / "LICENSE"
        if license_path.is_file():
            shutil.copy2(license_path, TARGET / "LICENSE")
        (TARGET / "VERSION").write_text(VERSION + "\n", encoding="utf-8")
        _compress_text(TARGET)
    missing = [name for name in REQUIRED if not (TARGET / name).is_file()]
    if missing:
        raise SystemExit(f"katex vendoring incomplete: {', '.join(missing)}")
    print(f"vendored katex {VERSION} at {TARGET}")


if __name__ == "__main__":
    main()
