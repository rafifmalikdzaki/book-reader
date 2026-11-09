<div align="center">

# Book Reader

**A private reading room for your PDF and Markdown library.**

Turn a folder of papers and notes into a searchable, annotatable library with a
native PDF.js reader, a clean Markdown reader, durable reading positions, and an
assistant that answers from your own collection.

[![CI](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)
![FastAPI](https://img.shields.io/badge/FastAPI-0.116+-009688?logo=fastapi&logoColor=white)
![Local-first](https://img.shields.io/badge/local--first-no%20accounts-8A6D3B)

</div>

Book Reader is a single-user web application that runs on your machine. Point it
at a directory of PDFs and Markdown files; it builds a library, remembers where
you stopped reading, keeps research notes attached to the text, and exposes the
whole collection to a retrieval-augmented assistant. There are no accounts, no
telemetry, and no cloud requirement. The only network destination is the chat
provider you configure.

> **Source checkouts:** the React UI ships as a generated bundle. Run
> `scripts/build_frontend.sh` once before starting the server. Wheels and the
> Docker image include the built bundle.

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Search](#search)
- [Ask the library](#ask-the-library)
- [Moving and renaming books](#moving-and-renaming-books)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Architecture](#architecture)
- [Development](#development)
- [Project layout](#project-layout)
- [Security and privacy](#security-and-privacy)

## Quick start

### Requirements

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 22.12+ and npm for source builds
- Optional: Elasticsearch 9 for fast library-wide BM25 search

```bash
git clone https://github.com/rafifmalikdzaki/book-reader.git
cd book-reader
uv sync --extra pageindex --extra agent
scripts/build_frontend.sh
uv run book-reader --library ~/Documents/Books
```

Open <http://127.0.0.1:8000>. The default library is `~/Documents/Books`; a
missing root exits with status 2. Reading state lives in
`$XDG_STATE_HOME/book-reader` (fallback `~/.local/state/book-reader`).

The `pageindex` extra enables cached PDF section trees and section-aware search.
The `agent` extra enables chat; without it, the readers, search, and notepad
continue to work. Chat credentials are optional and live in a gitignored `.env`:

```bash
MISTRAL_API_KEY=...          # or MISTRAL_API
INCEPTION_API_KEY=...
OPENROUTER_API_KEY=...
OLLAMA_API_KEY=...
BOOK_READER_CHAT_PRIORITY=mistral:mistral-small-latest,mistral:ministral-8b-latest,mistral:zai-glm-5-3-flash,inception:mercury-3,openrouter:openrouter/free,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free,ollama:gpt-oss:20b
```

### Docker

```bash
cp .env.example .env        # adjust BOOKS_DIR / BOOK_READER_PORT if needed
docker compose up --build   # reader + Elasticsearch, http://127.0.0.1:8000
docker compose run --rm reader book-reader --index   # build the search index
```

The library is mounted **read-only** at `/library`; state and caches persist in
the `reader-state` volume, and Elasticsearch data in `es-data`. Ports bind to
`127.0.0.1` only because the app has no authentication.

## What it does

| Area | Capability |
| --- | --- |
| **Library** | Tile grid with first-page previews, cached PDF titles/page counts, a list view, and three reading atmospheres (*Daylight Lamp*, *Dimmed Desk*, *Midnight Baize*). One search field filters titles live and runs full-text library search on Enter. Category filters replace shelf tabs. |
| **PDF reading** | The vendored PDF.js viewer with continuous scroll, thumbnails, outline, native find, zoom, rotate, download, print, presentation mode, and keyboard paging. |
| **Markdown reading** | CommonMark with tables, strikethrough, syntax highlighting, an outline, and relative links rewritten to library routes. HTML passthrough is disabled. |
| **Research notes** | Select text in either reader, add an annotation, and keep the note attached to a page range, line range, section, or character span. |
| **Reading memory** | Persisted page or scroll position with atomic writes, plus deep links such as `book.pdf#p12` and `notes.md#L40`. |
| **Search** | PageIndex section search, a bounded candidate-scored local page/line scan, or Elasticsearch BM25 with highlighted snippets. |
| **Ask** | A page-aware chat rail while reading, and a persistent category-scoped chat workspace at `/ask` with background agent execution and live reasoning step visibility. |
| **Auto-organize** | Mistral proposes a flat taxonomy from titles, section headings, and first-page excerpts. Categories are virtual; files never move. |

### Reading without leaving the page

The PDF reader is the upstream PDF.js viewer, kept native rather than wrapped in
a custom canvas. A small same-origin bridge connects it to the application:
deep-link restoration, page-change progress, text selection, and the current
page context for **Ask**. PDF.js, its worker, and KaTeX are vendored; the
application does not load them from a CDN.

The Markdown reader renders through `markdown-it-py` with tables, strikethrough,
and Pygments highlighting. Library-authored HTML is disabled, so a Markdown file
cannot inject scripts into the reading surface. Relative links resolve against
the library root and become proper reader routes.

### Notes that stay with the text

Select text in a PDF or Markdown document and choose **+ Note**. Notes are
grouped by idea, carry an annotation, and retain a locator: PDF page plus
word/character span, or Markdown line range plus section. The drawer links each
note back to its source.

Exports are designed to be pasted into an AI context:

- `GET /api/notepad/export?format=markdown` — quote, annotation, section,
  paragraph, page or line range, character span, and source anchor per note.
- `GET /api/notepad/export?format=json` — the same records for tooling.

## Search

`--search` (or `BOOK_READER_SEARCH`) selects the backend preference:

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Elasticsearch when reachable, then PageIndex section trees, then an in-process text scan |
| `elastic` | Elasticsearch only for library-wide queries |
| `pageindex` | Vectorless tree search over PageIndex section titles; no Elasticsearch needed |
| `local` | In-process text scan only; library-wide queries return 503 |

| Scope | Result |
| --- | --- |
| In-book (`/api/search?path=…&q=…`) | Backend-specific hits with page/line and section |
| Library-wide (`/api/search?q=…`) | Elasticsearch chunks, or PageIndex sections for books whose trees are cached |

Build or refresh the Elasticsearch index with `uv run book-reader --index`
(incremental, keyed by file mtime and size) or `--force-index`. Rebuilds prune
chunks and state entries for books no longer under the library root.
`GET /api/index/status` reports backend availability, chunk count, cached
section trees, and the background job. `POST /api/index/rebuild` starts a rebuild
in a worker thread and returns immediately with `{"started": true}`.

PDF sections come from [PageIndex](https://github.com/VectifyAI/PageIndex)
Flash, which reads the layout tree offline — no model and no API key. Trees are
cached in `sections.json` per file mtime; the first extraction for a book takes a
few seconds, and later queries against that book are dictionary lookups.

### Hybrid PageIndex retrieval

In-book PDF search is section-aware. The PageIndex tree nominates candidate
regions by title-match strength and depth, page text inside those regions is
scored with TF-IDF term weights, and section starts receive a deterministic
boost. When Elasticsearch is available, section hits are merged ahead of BM25
hits so RAG context keeps its section labels.

Measured with `scripts/benchmark_rag.py` on *A survey of recently developed
metaheuristics* (36 pages, 10 golden questions, page tolerance ±1):

| Backend | hit@1 | hit@3 | hit@5 | MRR | section@3 | p50 latency |
| --- | --- | --- | --- | --- | --- | --- |
| pageindex-hybrid | **1.00** | **1.00** | **1.00** | **0.95** | **1.00** | **9.4 ms** |
| elasticsearch | 0.90 | 1.00 | 1.00 | 0.78 | 1.00 | 24.3 ms |
| local page scan | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 213 ms |

```bash
uv run python scripts/benchmark_rag.py --library ~/Documents/Books
uv run python scripts/benchmark_rag.py --library ~/Documents/Books \
    --es-url http://127.0.0.1:9200 --es-index book-reader
```

## Ask the library

There are two Ask surfaces, with different jobs:

| Surface | Best for | Context |
| --- | --- | --- |
| **Reader Ask** | Following up while reading | Current book and page |
| **Home Ask** (`/ask`) | Longer research threads | Library-wide or selected categories, with saved sessions |

**Reader Ask** is a resizable side panel. Drag its left edge, or focus the handle
and use Arrow/Home/End, to resize it between 300 and 640 px; the width persists
in `localStorage`. Every answer links its sources back to `book.pdf#p12` or
`notes.md#L40`.

**Home Ask** is a full chat workspace with a session sidebar, transcript,
composer, and project folders. Retrieval is library-wide by default; the
**Categories** picker limits searches to selected virtual categories without
moving files. A session remembers its categories and resumes its transcript
across reloads. Agent turns execute in a shielded background task hub
(`SessionTaskHub`), so generations continue and persist to disk even if you
refresh or navigate away. Live reasoning steps (`Searching the library…`,
`Reading relevant excerpts…`) stream over Server-Sent Events
(`GET /api/chat/sessions/{id}/events`) with automatic polling fallback, and
concurrent duplicate turns on the same session are guarded with `409 Conflict`.

Sessions live in `chats.json` and expire seven days after their last change.
Pinned sessions and sessions assigned to a project are exempt. Deleting a
project unassigns its chats and refreshes their retention window; it never
deletes transcripts. Chat project folders are unrelated to library shelves.

The agent runs on Mistral, Inception, OpenRouter, or Ollama through a configurable
priority chain. The **Options** button picks a specific provider/model at
runtime. The tool budget is bounded: after four tool rounds, or a tool error, the
agent answers from the evidence it has collected instead of calling more tools.
Providers that return empty answers fall through to the next one in the chain.

Chat sends the selected passages to the configured provider. Use Ollama for a
fully local assistant when documents must not leave the machine.

## Moving and renaming books

Move, rename, or regroup books with your file manager; saved state is matched by
**content**, not by file name.

- At startup and whenever the library index is opened, a reindex compares the
  library with `library_manifest.json` in the state directory. Each book gets a
  SHA-256 content hash, cached by inode, size, and mtime, so unchanged books are
  not re-read.
- A path that disappeared and a path that appeared are paired only when their
  content hashes match one-to-one. Reading positions, notes, page counts, and
  PageIndex section trees move to the new path.
- Old bookmarks redirect to the new path. The index shows a one-time notice when
  a move was absorbed.
- Before any state rewrite, affected files are copied to
  `state/backups/reindex-<timestamp>/`. Existing state at a target path is never
  overwritten; the conflict is reported and the old copy stays in the backup.
- The migration holds one lock shared with every state writer and writes a
  transaction marker before touching stores. If a store write, manifest commit,
  or redirect log fails, all stores roll back to the snapshot. If the process
  dies midway, the next reindex restores that snapshot first. A concurrent note
  or reading-position write therefore lands either before the snapshot or after
  the rollback, never inside it.

Run a reindex on demand with `uv run book-reader --reindex`, the **Reindex
library** button under Options, or `POST /api/library/reindex`. The CLI takes an
exclusive lock on the state directory, so it refuses while a server is running;
use the button or API for a live server. The same lock prevents two servers from
sharing one state directory.

Deleting a book keeps its manifest entry, so restoring the same content later
under another name recovers its notes and place. A move made **and** edited
before a reindex cannot be identified by content; its old state stays in the
backup rather than being guessed.

Elasticsearch stores paths at index time: rebuild it with `--index` after a
reorganization. The local and PageIndex backends re-read the library live.

## Configuration

| CLI flag | Environment | Default |
| --- | --- | --- |
| `--library` | `BOOK_READER_LIBRARY` | `~/Documents/Books` |
| `--state-dir` | `BOOK_READER_STATE_DIR` | `$XDG_STATE_HOME/book-reader` or `~/.local/state/book-reader` |
| `--host` | `BOOK_READER_HOST` | `127.0.0.1` |
| — | `BOOK_READER_ALLOWED_HOSTS` | Loopback names when bound to loopback (DNS-rebinding guard); a comma list overrides; unset on a non-loopback bind disables the check |
| `--port` | `BOOK_READER_PORT` | `8000` |
| `--es-url` | `BOOK_READER_ES_URL` | Empty (Elasticsearch disabled) |
| `--es-index` | `BOOK_READER_ES_INDEX` | `book-reader` |
| `--search` | `BOOK_READER_SEARCH` | `auto` (`auto`/`elastic`/`pageindex`/`local`) |
| `--reindex` | — | Match moved/renamed books by content, migrate state, then exit |
| `--index` / `--force-index` | — | Build the index, then exit |
| — | `BOOK_READER_CHAT_PRIORITY` | Mistral chain → Inception → OpenRouter → Ollama |
| — | `BOOK_READER_<PROVIDER>_MODEL` | Per-provider model override |
| — | `MISTRAL_API_KEY` / `MISTRAL_API` | Mistral key (alias accepted) |

Compose additionally reads `BOOKS_DIR` (host path mounted at `/library`) and
`BOOK_READER_PORT` (host port) from `.env`.

HTML responses send a `Content-Security-Policy-Report-Only` header: no inline
scripts and same-origin assets only. It logs violations in the browser console
and does not block them. This is deliberate while the PDF.js iframe keeps its own
policy.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /` | Library index and library-wide search |
| `GET /ask` | Persistent library-wide chat workspace |
| `GET /design` | Development-only UI kitchen sink |
| `GET /book/{rel}` | PDF or Markdown reader |
| `GET /thumb.jpg?path=&width=` | First-page JPEG preview, content-hash cached |
| `GET /raw/{rel}` | Raw library file; only PDF, Markdown, and raster images are served inline |
| `GET /api/search?path=&q=&limit=` | In-book search (omit `path` for library-wide) |
| `GET /api/pages` | Page counts for the index |
| `POST /api/progress` | Persist `{"path", "page"}` or `{"path", "scroll"}` |
| `GET/POST/DELETE /api/notepad…` | Groups, notes, export |
| `GET /api/index/status` | Search backend status |
| `GET /api/organize/status` | Mistral organizer state and taxonomy |
| `POST /api/organize` | Start categorization (`confirm: true`; virtual shelves) |
| `GET/POST /api/chat/options` | Selectable models and the persisted choice |
| `GET /api/chat/status` | Chat provider chain and selection |
| `POST /api/chat` | Stateless reader-side question |
| `GET/POST /api/chat/sessions` | Persistent chat sessions |
| `GET/PATCH/DELETE /api/chat/sessions/{id}` | Session transcript, status, pin, project, categories |
| `POST /api/chat/sessions/{id}/messages` | Scoped RAG answer with sources (shielded background execution; `409` if already thinking) |
| `GET /api/chat/sessions/{id}/events` | SSE stream of live session status and reasoning steps |
| `GET/POST /api/chat/projects`, `DELETE /api/chat/projects/{id}` | Chat project folders |
| `POST /api/library/reindex` | Match moved/renamed books and migrate state |
| `POST /api/index/rebuild` | Index the library |
| `GET /healthz` | Container healthcheck |

## Architecture

Book Reader is a React 19 SPA served by FastAPI. The server owns the library
scan, state files, search, chat, and path safety; the browser owns the reading
surface and the chat workspace. One process owns each state directory at a time.

| Layer | Stack |
| --- | --- |
| Server | Python 3.12, FastAPI, Uvicorn, PyMuPDF, PageIndex (optional), Elasticsearch (optional) |
| Frontend | React 19, TypeScript 6, Vite 8, TanStack Query, React Router, CSS Modules |
| Chat | LangGraph/LangChain, Mistral/Inception/OpenRouter/Ollama |
| State | JSON under the state directory, guarded by a shared lock and atomic writes |

Design records and diagrams:

- Component/data flow: [`docs/book-reader-architecture.html`](docs/book-reader-architecture.html)
- PDF.js reading sequence: [`docs/diagrams/pdfjs-reading-sequence.html`](docs/diagrams/pdfjs-reading-sequence.html)
- Architecture decisions: [`docs/decisions/README.md`](docs/decisions/README.md)
- Project-local diagram skin: [`docs/diagram-style-guide.md`](docs/diagram-style-guide.md)

## Development

```bash
uv run pytest -q     # Python suite
cd frontend && npm test   # frontend suite
./scripts/ci.sh      # full gate: Python, frontend lint/typecheck/test/build
```

The React UI lives in `frontend/` (Node 22.12+, npm). The FastAPI server serves
the built SPA from `src/book_reader/static/app/`:

```bash
scripts/build_frontend.sh   # build into src/book_reader/static/app
uv run book-reader          # serve the SPA
cd frontend && npm run dev  # Vite on :5173, proxying to a backend on :8000
```

A source checkout must build the bundle before starting the server. Without it,
HTML routes answer `503` with a hint to run `scripts/build_frontend.sh`. The
Docker image builds the bundle in a Node stage. CI runs the same Python and
frontend checks plus a Docker build.

## Project layout

```text
src/book_reader/
  app.py             FastAPI factory, SPA/API wiring, service construction
  library.py         Scanning + path-safety choke point
  pdf.py             PyMuPDF LRU: page counts, metadata, text, search, thumbnails
  pages.py           Persisted page counts and extracted PDF titles
  mdrender.py        Markdown → HTML, cache, link rewriting, line search
  sections.py        PageIndex Flash section trees (offline, cached)
  search.py          Elasticsearch chunk index + candidate-scored local fallback
  notepad.py         Groups, notes, AI-context export
  progress.py        Reading positions
  preferences.py     Persisted UI choices
  reconcile.py       Content-hash reindex, state migration, move redirects
  organize.py        Content-hash category store, PageIndex signals, Mistral job
  chats.py           Persistent Ask sessions, execution status, retention, chat projects
  state_lock.py      One-process state ownership
  statemove.py       Simultaneous progress/page/section remaps, including swaps
  chat.py            LangGraph agent, tools, step callbacks, provider fallback, scoped retrieval
  chat_config.py     Shared chat request limits and model selection
  routes_notepad.py  Notepad HTTP routes
  routes_chat_sessions.py  Persistent chat, background task hub, SSE events, and project routes
  routes_library.py  Library/book JSON views and API routes
  routes_spa.py      React SPA shell routes
  security_headers.py  Host check and report-only CSP
  static/pdf_room.css  PDF.js room overrides
  static/vendor/     Pinned PDF.js and KaTeX distributions
  static/app/        Generated React bundle (gitignored; scripts/build_frontend.sh)
frontend/
  src/app/           Router, shell, settings dialogs
  src/features/      One folder per page or rail (library, ask, reader, notepad, ...)
  src/ui/            Design-system primitives (see /design)
  src/styles/        tokens.css, reset.css, fonts.css
  src/api/           Typed fetch client and payload types
```

## Security and privacy

Book Reader assumes a trusted, single-user machine. It has no accounts, roles, or
multi-tenant isolation. Keep it on `127.0.0.1`, or put an authenticating reverse
proxy in front of it before exposing it to a network.

- The library is treated as untrusted data: Markdown HTML is disabled, `/raw`
  sends non-document files as attachments, and static paths are confined to the
  application root.
- Host checking defaults to loopback names and protects against DNS rebinding;
  set `BOOK_READER_ALLOWED_HOSTS` when using a non-loopback bind.
- PDF.js runs from the vendored distribution. No PDF.js or KaTeX asset is loaded
  from a CDN.
- State is plain JSON in the state directory. Back up that directory to back up
  reading positions, notes, categories, and chat sessions.
- Chat passages are sent only to the provider you configure, and only when you
  ask a question.
