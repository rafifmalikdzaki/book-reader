"""Command line entry point."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn

from .app import DEFAULT_ES_INDEX, build_services, create_app

DEFAULT_LIBRARY = Path.home() / "Documents" / "Books"


def default_state_dir() -> Path:
    xdg = os.environ.get("XDG_STATE_HOME")
    if xdg:
        return Path(xdg) / "book-reader"
    return Path.home() / ".local" / "state" / "book-reader"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="book-reader",
        description="Local web reader for PDF and Markdown books",
    )
    parser.add_argument(
        "--library",
        default=os.environ.get("BOOK_READER_LIBRARY", str(DEFAULT_LIBRARY)),
        help="folder scanned for .pdf and .md books (default: %(default)s)",
    )
    parser.add_argument(
        "--state-dir",
        default=os.environ.get("BOOK_READER_STATE_DIR", str(default_state_dir())),
        help="folder holding progress, notes, and caches (default: %(default)s)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("BOOK_READER_HOST", "127.0.0.1"),
        help="bind address (default: %(default)s)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BOOK_READER_PORT", "8000")),
        help="bind port (default: %(default)s)",
    )
    parser.add_argument(
        "--es-url",
        default=os.environ.get("BOOK_READER_ES_URL", ""),
        help="Elasticsearch URL for library-wide search (default: %(default)s)",
    )
    parser.add_argument(
        "--es-index",
        default=os.environ.get("BOOK_READER_ES_INDEX", DEFAULT_ES_INDEX),
        help="Elasticsearch index name (default: %(default)s)",
    )
    parser.add_argument(
        "--index",
        action="store_true",
        help="build or update the Elasticsearch index, then exit",
    )
    parser.add_argument(
        "--force-index",
        action="store_true",
        help="rebuild the Elasticsearch index from scratch, then exit",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    library_root = Path(args.library).expanduser()
    if not library_root.is_dir():
        print(f"library root not found: {library_root}", file=sys.stderr)
        raise SystemExit(2)
    state_dir = Path(args.state_dir).expanduser()

    if args.index or args.force_index:
        services = build_services(
            library_root, state_dir, es_url=args.es_url, es_index=args.es_index
        )
        if services.elastic is None:
            print(
                "Elasticsearch is not configured; pass --es-url or set BOOK_READER_ES_URL",
                file=sys.stderr,
            )
            raise SystemExit(2)
        if not services.elastic.available():
            print(
                f"Elasticsearch is not reachable at {services.elastic.url}",
                file=sys.stderr,
            )
            raise SystemExit(2)
        print(
            f"indexing {library_root} into {services.elastic.url}/{services.elastic.index}…",
            flush=True,
        )
        stats = services.elastic.rebuild(services.library, force=args.force_index)
        print(
            "indexed {indexed}, skipped {skipped}, chunks {chunks}, total {total}".format(
                total=services.elastic.chunk_count(), **stats
            ),
            flush=True,
        )
        return

    print(f"book-reader: {library_root} → http://{args.host}:{args.port}", flush=True)
    uvicorn.run(
        create_app(library_root, state_dir, es_url=args.es_url, es_index=args.es_index),
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
