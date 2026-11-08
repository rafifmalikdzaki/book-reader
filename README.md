# book-reader

Local web reader for a folder of PDF and Markdown books, with a researcher
notepad and library-wide search.

- Library index with a default tile grid (first-page JPEG previews, progress,
  category) and a list view. One search field filters titles live and runs
  full-text library search on Enter; a category select replaces the old shelf
  tabs.
- PDF reader: the open-source **PDF.js** viewer (vendored, no CDN), with
  continuous scroll, thumbnails, outline, text selection/copy, native find,
  zoom, rotate, download, print, presentation mode, and keyboard paging. The
  app bridge keeps deep links, reading progress, page-aware **Ask**, and
  selection → note.
- Markdown reader: CommonMark (+ tables, strikethrough, Pygments highlighting)
  with relative links rewritten to library routes. HTML passthrough is
  **disabled**, so library Markdown cannot inject scripts.
- Markdown reader: CommonMark (+ tables, strikethrough, Pygments highlighting)
  with relative links rewritten to library routes. HTML passthrough is
  **disabled**, so library Markdown cannot inject scripts.
- Notepad: select text in either reader and add it to a group with an
  annotation. Notes carry a locator (PDF page + word/character span, or
  Markdown line range + section) and export as AI context in Markdown or JSON.
- Search: PageIndex section search when trees are cached, then a local page/line
  scan; Elasticsearch for fast library-wide BM25 search with highlighted
  snippets. PDF sections come from
  [PageIndex](https://github.com/VectifyAI/PageIndex) Flash, which reads the
  layout tree offline (no model, no API key).
- Reading position (page for PDFs, scroll ratio for Markdown) persisted to
  `progress.json` with atomic writes.
- **Ask the library**: a LangGraph agent answers questions with tools
  (`search_library`, `read_document`, `add_note`) over Mistral, Inception,
  OpenRouter, or Ollama, falling back down a configurable priority chain. The
  current page's real text is supplied before it is cited; answers render
  Markdown and LaTeX with locally vendored KaTeX. The **Options** button picks a
  specific provider/model at runtime.
- **Auto-organize**: a confirmed background job reads titles, PageIndex section
  headings, and short first-page excerpts and asks Mistral for a flat category
  taxonomy plus one category per document. Categories are virtual, stored by
  SHA-256 content ID in `categories.json`; files never move.

## Quickstart (uv)

```bash
uv sync
uv run book-reader                       # http://127.0.0.1:8000
uv run book-reader --library ~/Documents/Books --port 8765
```

Optional extras:

```bash
uv sync --extra pageindex --extra agent   # section trees + chat agent
```

Chat credentials live in a local `.env` (gitignored) and are loaded
automatically by `book-reader`:

```bash
MISTRAL_API_KEY=...          # or MISTRAL_API
INCEPTION_API_KEY=...
OPENROUTER_API_KEY=...
OLLAMA_API_KEY=...
BOOK_READER_CHAT_PRIORITY=mistral:mistral-small-latest,mistral:ministral-8b-latest,mistral:zai-glm-5-3-flash,inception:mercury-3,openrouter:openrouter/free,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free,ollama:gpt-oss:20b
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

## Reorganizing the library

Move, rename, or regroup books and folders with your file manager; saved state
is matched by **content**, not by file name.

- At startup and whenever the library index is opened, a reindex compares the
  library with `library_manifest.json` in the state directory. Each book gets a
  SHA-256 content hash (cached by inode/size/mtime, so unchanged books are not
  re-read).
- A path that disappeared and a path that appeared are paired only when their
  content hashes match one-to-one. Reading positions, notes, page counts, and
  PageIndex section trees are then moved to the new path.
- Old bookmarks redirect to the new path; the index shows a one-time notice
  when a move was absorbed.
- Before any state rewrite, the affected files are copied to
  `state/backups/reindex-<timestamp>/`. Existing state at a target path is
  never overwritten; that conflict is reported and the old copy stays in the
  backup.
- The migration holds one lock shared with every state writer, and writes a
  transaction marker before touching stores. If a store write, manifest commit,
  or redirect log fails, all stores are rolled back to the snapshot; if the
  process dies midway, the next reindex restores that snapshot first. A
  concurrent note or reading-position write therefore either lands before the
  snapshot or after the rollback, never inside it.

Run it on demand with `uv run book-reader --reindex`, the **Reindex library**
button under Options, or `POST /api/library/reindex`. The CLI takes an exclusive
lock on the state directory, so it refuses while a server is running; use the
button or the API for the live server. The same lock prevents two servers from
sharing one state directory.

Deleting a book keeps its manifest entry, so the same content restored later
under another name gets its notes and place back. A move made **and** edited
before a reindex cannot be identified by content; its old state is retained in
the backup rather than guessed. Movement detection starts with the first
manifest this version records; moves made before that cannot be reconstructed
from content. Elasticsearch stores paths at index time: after a reorg, rebuild
it with `--index` (the local and PageIndex backends re-read the library live).

## Notepad

1. Open a book and select text (the PDF text layer is selectable; Markdown is
   ordinary text).
2. Click **+ Note**, pick a group, add an annotation, save.
3. The drawer lists notes grouped by idea, with a link back to the source
   (`book.pdf#p12`, `notes.md#L40`). Groups can be created, notes moved between
   them, and groups deleted together with their notes.

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
(incremental, keyed by file mtime and size) or `--force-index`. Rebuilds prune
chunks and state entries for books that are no longer under the library root.
`GET /api/index/status` reports backend availability, chunk count, cached
section trees, and the background job; `POST /api/index/rebuild` starts a
rebuild in a worker thread and returns immediately with `{"started": true}`.

Sections for PDF hits and notes come from PageIndex Flash
(`pageindex.flash.main.extract_toc`), cached in `sections.json` per file mtime.
The first tree extraction for a book takes a few seconds; every later query
against that book is a dictionary lookup.

### Hybrid PageIndex retrieval

In-book PDF search is section-aware: the PageIndex tree nominates candidate
regions (title match strength and depth), page text inside those regions is
scored with TF-IDF term weights, and section starts receive a deterministic
boost. When Elasticsearch is also available, section hits are merged ahead of
BM25 hits so RAG context keeps its section labels.

Measured with `scripts/benchmark_rag.py` on *A survey of recently developed
metaheuristics* (36 pages, 10 golden questions, page tolerance ±1):

| backend | hit@1 | hit@3 | hit@5 | MRR | section@3 | p50 latency |
|---|---|---|---|---|---|---|
| pageindex-hybrid | **1.00** | **1.00** | **1.00** | **0.95** | **1.00** | **9.4 ms** |
| elasticsearch | 0.90 | 1.00 | 1.00 | 0.78 | 1.00 | 24.3 ms |
| local page scan | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 213 ms |

```bash
uv run python scripts/benchmark_rag.py --library ~/Documents/Books
uv run python scripts/benchmark_rag.py --library ~/Documents/Books \
    --es-url http://127.0.0.1:9200 --es-index book-reader
```

## Chat

The **Ask** button opens a chat panel; the panel sends the current book and
page as context, and answers link every source back to `book.pdf#p12` or
`notes.md#L40`. The **Options** button selects `Auto` (the priority chain) or a
specific `provider:model`; the choice is stored in
`preferences.json` and applies to later requests.

- `GET /api/chat/status` — providers, cached models, selected model.
- `GET/POST /api/chat/options` — list and persist the model choice.
- `POST /api/chat` — `{"messages": [...], "book": ..., "page": ..., "model": ...}`.

Tool budget is bounded: after four tool rounds (or a tool error) the agent
answers from the collected evidence without further tool calls, and providers
that return empty answers fall through to the next one in the chain.

Note: chat sends the selected passages to the configured provider; use Ollama
locally if documents must not leave the machine.

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
| `--reindex` | — | match moved/renamed books by content, migrate state, then exit |
| `--index` / `--force-index` | — | build the index, then exit |
| — | `BOOK_READER_CHAT_PRIORITY` | Mistral chain → Inception → OpenRouter → Ollama |
| — | `BOOK_READER_<PROVIDER>_MODEL` | per-provider model override |
| — | `MISTRAL_API_KEY` / `MISTRAL_API` | Mistral key (alias accepted) |

Compose additionally reads `BOOKS_DIR` (host path mounted at `/library`) and
`BOOK_READER_PORT` (host port) from `.env`.

## HTTP routes

| Route | Purpose |
| --- | --- |
| `GET /` | library index + library-wide search |
| `GET /book/{rel}` | PDF or Markdown reader |
| `GET /thumb.jpg?path=&width=` | first-page JPEG preview, content-hash cached |
| `GET /raw/{rel}` | raw library file |
| `GET /api/search?path=&q=&limit=` | in-book search (omit `path` for library-wide) |
| `GET /api/pages` | page counts for the index |
| `POST /api/progress` | persist `{"path", "page"}` or `{"path", "scroll"}` |
| `GET/POST/DELETE /api/notepad…` | groups, notes, export |
| `GET /api/index/status` | search backend status |
| `GET /api/organize/status` | Mistral organizer state and taxonomy |
| `POST /api/organize` | start categorization (`confirm: true`; virtual shelves) |
| `GET/POST /api/chat/options` | selectable models and the persisted choice |
| `GET /api/chat/status` | chat provider chain and selection |
| `POST /api/chat` | agentic question over the library |
| `POST /api/library/reindex` | match moved/renamed books by content and migrate state |
| `POST /api/index/rebuild` | index the library |
| `GET /healthz` | container healthcheck |

## Architecture

A validated component/data-flow diagram is checked in at
[`docs/book-reader-architecture.html`](docs/book-reader-architecture.html).

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
  pdf.py             PyMuPDF LRU: page counts, metadata, text, search, thumbnails
  pages.py           persisted page counts
  mdrender.py        Markdown → HTML, cache, link rewriting, line search
  sections.py        PageIndex Flash section trees (offline, cached)
  search.py          Elasticsearch chunk index + local fallback
  notepad.py         groups, notes, AI-context export
  progress.py        reading positions
  preferences.py     persisted UI choices
  reconcile.py       content-hash reindex, state migration, move redirects
  organize.py        content-hash category store, PageIndex signals, Mistral job
  state_lock.py      one-process state ownership
  statemove.py       simultaneous progress/page/section remaps, including swaps
  chat.py            LangGraph agent, tools, provider fallback
  routes_notepad.py  notepad HTTP routes
  templates/         index and reader pages
  static/notepad.js  notepad drawer, note capture
  static/pdf_reader.js  PDF.js iframe bridge (progress, notes, resize)
  static/vendor/     pinned PDF.js and KaTeX distributions
```
