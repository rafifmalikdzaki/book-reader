# ADR-006: Auto-Build Frontend Bundle on Source Checkout Startup

## Status

Accepted (amends operational workflow of [ADR-001](ADR-001-react-spa.md))

## Date

2026-11-09

## Context

[ADR-001](ADR-001-react-spa.md) retired the legacy Jinja templates in favor of a
React SPA built into `src/book_reader/static/app/` (gitignored). Previously, a
source checkout required developers to manually run `scripts/build_frontend.sh`
(which always ran a full `npm ci`) and pass `--extra pageindex --extra agent` to
`uv sync` before `uv run book-reader` could serve the UI. Forgetting the build
step resulted in a `503` error page, and editing `frontend/src/` without
re-running the script served a stale bundle.

## Decision

1. **`ensure_frontend_bundle()` in `book_reader.__main__`**: When starting the
   server from a source checkout (`frontend/package.json` and
   `scripts/build_frontend.sh` present), the CLI checks whether
   `src/book_reader/static/app/index.html` is missing or older than files in
   `frontend/`. When missing or stale, it automatically builds the bundle before
   starting Uvicorn.
2. **Incremental `scripts/build_frontend.sh`**: `npm ci` runs only when
   `frontend/node_modules` is absent, `package-lock.json` is newer than
   `node_modules`, or `CI=true`. Subsequent builds run `npm run build` directly
   (~400 ms).
3. **Default dependencies in `pyproject.toml`**: `pageindex` and the LangGraph
   agent dependencies are included in the default `dependencies` list (while
   retaining `[project.optional-dependencies]` extras for compatibility) so a
   fresh checkout starts with a single `uv run book-reader` command.
4. **Runtime 503 guard preserved**: `routes_spa.py` still returns HTTP 503 with
   `Cache-Control: no-store` if `create_app()` is invoked programmatically
   against a directory without a built bundle (e.g. when `npm` is unavailable).

## Consequences

- Starting from a source checkout requires one command (`uv run book-reader`)
  or `docker compose up --build`.
- Packaged wheels and Docker images (where `frontend/` is absent and
  `static/app/` is prebuilt) skip the startup check cleanly.
