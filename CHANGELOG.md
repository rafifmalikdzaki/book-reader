# Changelog

## [Unreleased]

### Added

- React 19 SPA for the library, Ask workspace, Markdown reader, PDF viewer, notepad,
  settings dialog, and category-scoped chat.
- Persistent Ask sessions and chat projects with category-scoped RAG and seven-day
  inactivity retention; pinned and project-assigned sessions are exempt.
- Vite build pipeline, typed frontend API contracts, Vitest/Testing Library coverage,
  and FastAPI SPA shell tests.
- ADRs for the SPA cutover, vendored reader assets, content-hash reindex, local trust
  boundary, and Ask retention.
- Live agent process on `/ask`: steps, documents found (`found` SSE event) and model
  reasoning stream into a collapsible card while the answer is generated.

### Changed

- FastAPI now serves the SPA bundle from `static/app`; the React shell is the only UI.
- A source checkout must run `scripts/build_frontend.sh` before `uv run book-reader`.
- Reader progress writes are flushed on route unmount; library data refreshes on
  remount without losing the one-time relocation notice.
- `/raw` serves only PDF, Markdown, and raster images inline; other library files
  download as `application/octet-stream`.
- Ask and the reader chat rail auto-scroll only while you are following the latest
  output; scrolling up stops the view from jumping to the bottom.

- Backend modules are grouped feature-first (`state/`, `library/`, `reading/`, `notes/`,
  `search/`, `chat/`, `organize/`, `reindex/`, `api/`) with a `services.py` composition
  root; HTTP paths, CLI flags, state files and payloads are unchanged (ADR-009).

### Removed

- Jinja templates, legacy `static/*.js`, `BOOK_READER_UI`, and the `--ui` CLI flag.
- The legacy Jinja route tests and the `ui_mode` module.

### Fixed

- Precompressed static requests can no longer escape the static root through `..` or
  symlinks.
- Library HTML/SVG files are no longer rendered same-origin from `/raw`.
- Selection timers cannot reopen a note bubble after capture; chat input no longer
  sends during IME composition.
- Direct unknown books return a shell with the correct error status; moved books keep
  their server-side 307 redirect.
