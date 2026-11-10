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
  reasoning stream into a card (collapsed by default) while the answer is generated.
- Any Ask chat can be renamed from its header.
- Home desk at `/`: greeting, an Ask box, continue reading, recently opened books, notes
  from the current book, recent chats, and the library below, grouped by category, tag or
  Zotero collection.
- Two-page spread in the PDF reader: a toolbar toggle, remembered between books and off
  below 720px so a phone still shows one page.
- Read-only Zotero integration (`--zotero-dir`): authors, year, tags, collections and the
  Zotero title on recognised books. The database is opened immutable; nothing is written.
- Paper import by DOI or arXiv id into `Papers/`, with title, authors, keywords and DOI
  written into the PDF's own Info dictionary.
- `GET /api/papers/keywords` exposes those embedded keywords and authors to the UI.

### Changed

- Ask citations are grouped per book, with passages gathered under their section as page
  or line chips, instead of one identical row per retrieved passage.
- A Markdown horizontal rule (`---`) renders as a rule in answers, not as three dashes.
- Ask composes its system prompt per question from steering modules
  (`skills/steering/*.md`, chosen in `chat/guidance.py`, at most two) and binds only the tools
  those modules name. Locator and note questions no longer carry the OpenUI component guide or
  the note-writing tool: a plain library question drops from ~3.5k to ~1.4k prompt+tools
  tokens, a locator question to ~0.9k.
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
- A link to `/ask?q=…&send=1` no longer asks the question for the visitor: the home box
  hands its question over in router state, and `?q=` only prefills the composer.
- Paper downloads connect to the address that passed the public-address check, so a
  re-resolving name cannot reach a private address; bodies stream to disk under the same
  150 MB cap, and a name taken mid-download is never overwritten.
- The PDF reader keeps its place across zoom, window resize and spread changes, including
  the offset within the current page.
- The library scan skips source checkouts only when the folder holds no PDF of its own, so
  a book kept beside its code samples is still listed; `README.md` files are never books.
