"""Command line entry point."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from .app import DEFAULT_ES_INDEX, build_services, create_app
from .state_lock import StateDirectoryLock, StateLockedError

DEFAULT_LIBRARY = Path.home() / "Documents" / "Books"


def load_env(directory: Path | None = None) -> bool:
    """Load a local ``.env`` (if any) before CLI defaults are resolved."""
    env_file = (directory or Path.cwd()) / ".env"
    if not env_file.is_file():
        return False
    load_dotenv(env_file, override=False)
    return True


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
        "--search",
        choices=["auto", "elastic", "pageindex", "local"],
        default=os.environ.get("BOOK_READER_SEARCH", "auto"),
        help="search backend preference (default: %(default)s)",
    )
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="match moved/renamed books by content, migrate saved state, then exit",
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
    load_env()
    args = build_parser().parse_args(argv)
    library_root = Path(args.library).expanduser()
    if not library_root.is_dir():
        print(f"library root not found: {library_root}", file=sys.stderr)
        raise SystemExit(2)
    state_dir = Path(args.state_dir).expanduser()

    if args.reindex:
        lock = _locked_state(state_dir)
        try:
            services = build_services(
                library_root,
                state_dir,
                es_url=args.es_url,
                es_index=args.es_index,
                search_mode=args.search,
            )
            report = services.reconciler.sync()
            print(
                f"reindexed: {report.count} moved, {report.added} new, "
                f"{report.missing} missing, {report.hashed} hashed"
            )
            if report.failed:
                print(f"reindex failed: {', '.join(report.failed)}", file=sys.stderr)
                raise SystemExit(2)
            if report.backed_up:
                print(f"state backup: {report.backed_up}")
            for conflict in report.conflicts:
                print(
                    "conflict: {store} {from} -> {to}".format(**conflict),
                    file=sys.stderr,
                )
        finally:
            lock.release()
        return

    if args.index or args.force_index:
        lock = _locked_state(state_dir)
        try:
            services = build_services(
                library_root,
                state_dir,
                es_url=args.es_url,
                es_index=args.es_index,
                search_mode=args.search,
            )
            if services.elastic is None:
                print(
                    "Elasticsearch is not configured; pass --es-url or set BOOK_READER_ES_URL",
                    file=sys.stderr,
                )
                raise SystemExit(2)
            if not services.elastic.reachable():
                print(
                    f"Elasticsearch is not reachable at {services.elastic.url}",
                    file=sys.stderr,
                )
                raise SystemExit(2)
            report = services.reconciler.sync()
            if report.failed:
                print(f"reindex failed: {', '.join(report.failed)}", file=sys.stderr)
                raise SystemExit(2)
            if report.count:
                print(f"reindexed {report.count} moved book(s) before indexing", flush=True)
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
        finally:
            lock.release()
        return

    try:
        app = create_app(
            library_root,
            state_dir,
            es_url=args.es_url,
            es_index=args.es_index,
            search_mode=args.search,
        )
    except StateLockedError as exc:
        print(f"cannot start the reader: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc

    print(f"book-reader: {library_root} → http://{args.host}:{args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


def _locked_state(state_dir: Path) -> StateDirectoryLock:
    lock = StateDirectoryLock(state_dir)
    try:
        lock.acquire()
    except StateLockedError as exc:
        print(f"cannot use the state directory: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    return lock


if __name__ == "__main__":
    main()
