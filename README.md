# book-reader

Local web reader for a folder of PDF and Markdown books, with a researcher
notepad and library-wide search.

- Library index grouped by top-level folder, page counts, "Continue reading".
- PDF reader: server-rendered page images (PyMuPDF), selectable text layer,
  prev/next/first/last, page jump, zoom, table of contents, in-book search,
  keyboard navigation.
- Markdown reader: CommonMark (+ tables, strikethrough, Pygments highlighting)
  with relative links rewritten to library routes. HTML passthrough is
  **disabled**, so library Markdown cannot inject scripts.
- Notepad: select text in either reader and add it to a group with an
  annotation. Notes carry a locator (PDF page + word/character span, or
  Markdown line range + section) and export as AI context in Markdown or JSON.
- Search: in-process text scan by default; Elasticsearch for fast library-wide
  BM25 search with highlighted snippets. PDF sections come from
  [PageIndex](https://github.com/VectifyAI/PageIndex) Flash, which reads the
  layout tree offline (no model, no API key).
- Reading position (page for PDFs, scroll ratio for Markdown) persisted to
  `progress.json` with atomic writes.

## Quickstart (uv)

```bash
uv sync
uv run book-reader                       # http://127.0.0.1:8000
uv run book-reader --library ~/Documents/Books --port 8765
```

Optional extras:

```bash
uv sync --extra pageindex   # section trees for PDFs (PageIndex Flash)
```

Default library is `~/Documents/Books`; a missing root exits with status 2.
State lives in `$XDG_STATE_HOME/book-reader` (fallback
`~/.local/state/book-reader`).

## Quickstart (Docker)

```bash
cp .env.example .env        # adjust BOOKS_DIR / BOOK_READER_PORT if needed
docker compose up --build   # reader + Elasticsearch, http://127.0.0.1:8000
docker compose run --rm reader book-reader --index   # build the search index
```

The library is mounted **read-only** at `/library`; state and caches persist in
the `reader-state` volume, Elasticsearch data in `es-data`. Ports bind to
`127.0.0.1` only because the app has no authentication.

## Notepad

1. Open a book and select text (the PDF text layer is selectable; Markdown is
   ordinary text).
2. Click **+ Note**, pick a group, add an annotation, save.
3. The drawer lists notes grouped by idea, with a link back to the source
   (`book.pdf#p12`, `notes.md#L40`). Groups can be created, renamed by moving
   notes, and deleted.

Exports:

- `GET /api/notepad/export?format=markdown` — quote, annotation, section,
  paragraph, page or line range, character span, and source anchor per note.
- `GET /api/notepad/export?format=json` — the same records for tooling.

## Search

`--search` (env `BOOK_READER_SEARCH`) selects the backend preference:

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Elasticsearch when reachable, then PageIndex section trees, then in-process text scan |
| `elastic` | Elasticsearch only for library-wide queries |
| `pageindex` | Vectorless tree search over PageIndex section titles; no Elasticsearch needed |
| `local` | In-process text scan only; library-wide queries return 503 |

| Scope | Result |
| --- | --- |
| In-book (`/api/search?path=…&q=…`) | Backend-specific hits with page/line + section |
| Library-wide (`/api/search?q=…`) | Elasticsearch chunks, or PageIndex sections for books whose trees are cached |

Build or refresh the Elasticsearch index with `uv run book-reader --index`
(incremental, keyed by file mtime and size) or `--force-index`.
`GET /api/index/status` reports backend availability and chunk count;
`POST /api/index/rebuild` does the same from the browser session.

Sections for PDF hits and notes come from PageIndex Flash
(`pageindex.flash.main.extract_toc`), cached in `sections.json` per file mtime.
The first tree extraction for a book takes a few seconds; every later query
against that book is a dictionary lookup.

## Configuration

| CLI flag | Environment | Default |
| --- | --- | --- |
| `--library` | `BOOK_READER_LIBRARY` | `~/Documents/Books` |
| `--state-dir` | `BOOK_READER_STATE_DIR` | `$XDG_STATE_HOME/book-reader` or `~/.local/state/book-reader` |
| `--host` | `BOOK_READER_HOST` | `127.0.0.1` |
| `--port` | `BOOK_READER_PORT` | `8000` |
| `--es-url` | `BOOK_READER_ES_URL` | empty (Elasticsearch disabled) |
| `--es-index` | `BOOK_READER_ES_INDEX` | `book-reader` |
| `--search` | `BOOK_READER_SEARCH` | `auto` (`auto`/`elastic`/`pageindex`/`local`) |
| `--index` / `--force-index` | — | build the index, then exit |

Compose additionally reads `BOOKS_DIR` (host path mounted at `/library`) and
`BOOK_READER_PORT` (host port) from `.env`.

## HTTP routes

| Route | Purpose |
| --- | --- |
| `GET /` | library index + library-wide search |
| `GET /book/{rel}` | PDF or Markdown reader |
| `GET /page.png?path=&page=&zoom=` | rendered PDF page (PNG, ETag) |
| `GET /api/text?path=&page=` | selectable text layer with word boxes and section |
| `GET /raw/{rel}` | raw library file |
| `GET /api/search?path=&q=&limit=` | in-book search (omit `path` for library-wide) |
| `GET /api/pages` | page counts for the index |
| `POST /api/progress` | persist `{"path", "page"}` or `{"path", "scroll"}` |
| `GET/POST/DELETE /api/notepad…` | groups, notes, export |
| `GET /api/index/status` | search backend status |
| `POST /api/index/rebuild` | index the library |
| `GET /healthz` | container healthcheck |

## Development

```bash
uv run pytest -q     # test suite
./scripts/ci.sh      # format check, lint, types, tests (same gate as CI)
```

CI (`.github/workflows/ci.yml`) runs the same gate plus a Docker build.

## Layout

```
src/book_reader/
  app.py             FastAPI factory, reader routes, service wiring
  library.py         scanning + path-safety choke point
  pdf.py             PyMuPDF document LRU, render, text, words, search, TOC
  pages.py           persisted page counts
  mdrender.py        Markdown → HTML, cache, link rewriting, line search
  sections.py        PageIndex Flash section trees (offline, cached)
  search.py          Elasticsearch chunk index + local fallback
  notepad.py         groups, notes, AI-context export
  progress.py        reading positions
  routes_notepad.py  notepad HTTP routes
  templates/         index and reader pages
  static/notepad.js  notepad drawer, note capture
```
