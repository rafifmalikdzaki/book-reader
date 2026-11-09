<div align="center">

# 📖 Book Reader

**A local-first, private reading room and pedagogical research workspace for your PDF and Markdown collection.**

Turn any folder of papers, textbooks, and notes into an organized, searchable library with continuous PDF.js reading, rich Markdown rendering, durable reading memory, and a grounded AI teacher that answers with verifiable citations.

[![CI](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116+-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=flat&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Local-First](https://img.shields.io/badge/Local--First-Zero_Telemetry-8A6D3B?style=flat)](#security-and-privacy)

[Quick Start](#-quick-start) • [Key Features](#-key-features) • [AI Integration & Socratic Tutor](#-ai-research--socratic-tutor) • [Search Architecture](#-search--retrieval) • [HTTP API](#-http-api) • [Architecture](#-architecture)

</div>

---

## ⚡ Quick Start

### Option 1: One Command with `uv` (Recommended)

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and Node.js 22+:

```bash
git clone https://github.com/rafifmalikdzaki/book-reader.git
cd book-reader
uv run book-reader
```

Open <http://127.0.0.1:8000>.

> **Note**: On startup, `book-reader` checks whether the React SPA bundle is built and automatically runs `scripts/build_frontend.sh` if needed. The default library points to `~/Documents/Books` (override with `--library /path/to/books`).

### Option 2: Docker Compose

```bash
docker compose up --build
```

Mounts `~/Documents/Books` read-only at `/library`. State persists in the `reader-state` volume, and optional Elasticsearch BM25 data in `es-data`.

### Optional: AI Provider Keys

Add keys to a local, gitignored `.env`:

```env
INCEPTION_API_KEY=...
MISTRAL_API_KEY=...          # or MISTRAL_API
OPENROUTER_API_KEY=...
OLLAMA_API_KEY=...
BOOK_READER_CHAT_PRIORITY=inception:mercury-3,mistral:mistral-small-latest,mistral:ministral-8b-latest,mistral:zai-glm-5-3-flash,openrouter:openrouter/free,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free,ollama:gpt-oss:20b
```

---

## ✨ Key Features

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BOOK READER PLATFORM                            │
├───────────────────┬───────────────────┬───────────────────┬─────────────────┤
│ 📚 Library & Shelf│ 📄 Reader Surfaces│ 📝 Notepad System │ 🎓 Pedagogical  │
│   • Cover previews│   • PDF.js native │   • Anchored notes│    AI Teacher   │
│   • Reading modes │   • Markdown AST  │   • Multi-span loc│   • Explain Mode│
│   • Move tracking │   • KaTeX math    │   • Markdown /    │   • Socratic    │
│   • Virtual cats  │   • Deep links    │     JSON export   │     Tutor Skill │
└───────────────────┴───────────────────┴───────────────────┴─────────────────┘
```

- **Reading Atmospheres**: Switch effortlessly between *Daylight Lamp*, *Dimmed Desk*, and *Midnight Baize* themes.
- **Native PDF.js Reader**: Continuous scroll, thumbnail navigation, table of contents, text selection, rotation, and presentation mode. No CDN dependencies.
- **Strict Markdown Reader**: Server-sanitized CommonMark with Pygments syntax highlighting, heading outlines, and line-based deep links (`notes.md#L40`).
- **Anchored Research Notepad**: Highlight passages in either reader to capture notes anchored to PDF page character offsets or Markdown source lines.
- **Durable Reading Memory**: Preserves page and scroll progress across sessions and machine reboots.
- **Content-Hash Move Protection**: Move or rename library folders in your OS; reading positions, notes, and virtual categories track stable SHA-256 content hashes automatically.

---

## 🎓 AI Research & Socratic Tutor

Book Reader transforms traditional passive search into an active, pedagogical learning environment.

### 1. Dual Pedagogical Modes

- **Master Teacher Mode (`Explain`)**: Focuses on structured explanations. Employs a proven conceptual hierarchy:
  1. **Intuition** (why the idea exists in plain language)
  2. **Formal Definition & Equations** (rigorous mathematical formulation via LaTeX)
  3. **Worked Examples & Citations** (drawn directly from your book with exact locators like `paper.pdf#p14`)
- **Jane Street Socratic Tutor Mode (`Socratic Tutor`)**: Implements Jane Street's [`socratic-tutor`](https://github.com/janestreet/agent_skills/blob/master/socratic-tutor/SKILL.md) skill:
  - Decomposes target chapters into 4–8 concrete subskills.
  - Runs a 3–5 question placement diagnostic **one question at a time**.
  - Renders a live **0–5 Mastery Skill Map** (`0 unaware · 1 heard of it · 2 can follow · 3 with help · 4 independent · 5 can teach`).
  - Maieutic questioning loop: never lectures, probes misconceptions, plays devil's advocate on correct answers, and interleaves spaced review.
  - Interactive commands supported: `show progress`, `harder`, `easier`, `just tell me`, `save state`, and `resume from:`.

### 2. Lightweight Question-Adaptive Generative UI (OpenUI)

Instead of dense walls of raw text, responses render tailored OpenUI components (<5 KB bundle footprint, zero third-party UI dependencies):

| Question / Task Type | Rendered Component | Key Affordances |
| :--- | :--- | :--- |
| **Socratic Tutoring** | `<SkillMap />` | Radial SVG mastery ring, 0–5 mastery bars, 1-click *Practice* & tutor controls |
| **Section & Concept Analysis** | `<ConceptCard />` | Stacked Intuition, Formal Mechanism, Worked Example, Takeaways, follow-up actions |
| **System & Concept Topology** | `<ConceptGraph />` | Interactive SVG node-link DAG diagram with clickable node inspector |
| **Trade-offs & Comparisons** | `<ComparisonTable />` | Structured side-by-side matrix with synthesis verdict |
| **Quantitative Benchmarks** | `<Chart />` | Horizontal comparison bar chart with `tabular-nums` metric scaling |
| **Algorithms & Derivations** | `<StepWalkthrough />` | Numbered vertical step timeline with LaTeX equation blocks & *Unpack step* |
| **Library Surveys & Recs** | `<BookList />` | Cover thumbnail previews, fit justification, *Inspect outline* & *Open Book →* |
| **Interactive Socratic Checks** | `<QuizCheck />` | Prompt verification with collapsible hint and selectable interactive choices |

### 3. Deep Section & Chapter Extraction

Unlike standard RAG pipelines that truncate text after a single page:
- `get_book_outline(book)` inspects the complete PageIndex Flash layout tree or Markdown heading hierarchy.
- `read_section(book, section)` extracts multi-page section spans (up to 10 pages / 10,000 characters) so mathematical proofs and arguments are never cut off.
- `list_books(query, category)` scans the library with cached human-readable PDF titles.
- `read_notes(book, query)` pulls your saved thoughts into the reasoning loop.
- **Real-Time Streaming & Control**: Live token streaming and reasoning step visibility over Server-Sent Events (`GET /api/chat/sessions/{id}/events`), with one-click **Stop / Cancel** generation (`POST /api/chat/sessions/{id}/cancel`).

---

## 🔍 Search & Retrieval

Book Reader supports hybrid multi-tier retrieval configured via `--search`:

| Mode | Strategy |
| :--- | :--- |
| **`auto`** *(default)* | Elasticsearch BM25 when reachable, then PageIndex section trees, falling back to local text scan |
| **`pageindex`** | Vectorless hierarchy search over offline PageIndex Flash layout trees; no external services |
| **`elastic`** | Pure Elasticsearch BM25 full-text chunk search |
| **`local`** | Fast candidate-scored in-process text scan |

```bash
# Build or update the Elasticsearch index
uv run book-reader --index

# Benchmark retrieval accuracy against your collection
uv run python scripts/benchmark_rag.py --library ~/Documents/Books

# Evaluate Ask + Socratic Tutor + OpenUI capabilities (offline or live Mercury 3)
uv run python scripts/eval_ask.py
uv run python scripts/eval_ask.py --live --model inception:mercury-3
```

---

## 📡 HTTP API

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/library` | `GET` | Library index, shelf categories, recent resume cards |
| `/api/book` | `GET` | PDF viewer URL, metadata, and reading progress |
| `/api/book/markdown` | `GET` | Sanitized CommonMark HTML and heading outline |
| `/api/progress` | `POST` | Atomically save PDF page or Markdown scroll ratio |
| `/api/search` | `GET` | In-book or library-wide multi-tier search |
| `/api/chat/sessions` | `GET` / `POST` | List and create persistent 7-day Ask sessions |
| `/api/chat/sessions/{id}` | `GET` / `PATCH` / `DELETE` | Manage session state, pins, and project assignments |
| `/api/chat/sessions/{id}/messages` | `POST` | Send question in `teacher` or `tutor` mode (background shielded) |
| `/api/chat/sessions/{id}/events` | `GET` | SSE stream for real-time token deltas and reasoning steps |
| `/api/chat/sessions/{id}/cancel` | `POST` | Abort in-flight generation and reset session state |
| `/api/notepad` | `GET` / `POST` / `PATCH` | Notes, groups, and AI-context export (`format=json\|markdown`) |
| `/api/library/reindex` | `POST` | Content-hash reconciliation and move redirection |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FASTAPI APPLICATION                           │
│  ┌────────────────────┬────────────────────┬────────────────────────┐  │
│  │   Library Router   │  Notepad & Progress│  Chat & Sessions Hub   │  │
│  └─────────┬──────────┴─────────┬──────────┴───────────┬────────────┘  │
└────────────┼────────────────────┼──────────────────────┼───────────────┘
             │                    │                      │
   ┌─────────▼────────┐ ┌─────────▼────────┐   ┌─────────▼────────────┐
   │ PyMuPDF Cache &  │ │ JSON Store Lock  │   │ LangGraph Agent &    │
   │ PageIndex Flash  │ │ Atomic Backups   │   │ Provider Priority    │
   └──────────────────┘ └──────────────────┘   └──────────────────────┘
             ▲                                           │
             │           HTTP / SSE Token Stream         ▼
┌────────────┴───────────────────────────────────────────────────────────┐
│                           REACT 19 SPA (VITE)                          │
│  ┌────────────────────┬────────────────────┬────────────────────────┐  │
│  │ PDF.js / MD Reader │ /ask Workspace     │ OpenUI Block Renderer  │  │
│  └────────────────────┴────────────────────┴────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Backend**: Python 3.12, FastAPI, Uvicorn, PyMuPDF, PageIndex Flash, LangGraph.
- **Frontend**: React 19, TypeScript strict mode, Vite 8, TanStack Query, React Router, CSS Modules with strict design tokens (`tokens.css`).
- **Storage**: Plain JSON with file-lock transactions, automatic pre-write backups, and content-addressed recovery.

---

## 🛠️ Development

```bash
# Python unit tests & linting
uv run pytest -q
uv run ruff check .
uv run mypy src tests

# Frontend checks
cd frontend && npm run lint && npm run typecheck && npm test

# Full CI gate (Python checks, frontend lint/typecheck/tests/build)
./scripts/ci.sh

# Dev server with HMR (proxies API to localhost:8000)
cd frontend && npm run dev
```

---

## 🔒 Security and Privacy

- **Single-User Localhost**: No authentication, multi-tenant boundaries, or telemetry. Runs bound to `127.0.0.1` by default with DNS rebinding host protection.
- **No Remote CDNs**: PDF.js, its web worker, and KaTeX fonts/scripts are vendored locally under `src/book_reader/static/vendor/`.
- **Untrusted Library Sandboxing**: User-authored Markdown HTML execution is disabled. Arbitrary files served via `/raw` are served as forced attachments with `nosniff`.
- **Local AI Privacy**: Point your chat provider to a local [Ollama](https://ollama.com/) instance for 100% offline document analysis without network transmission.

---

<div align="center">
  <sub>Built for focused, long-form technical reading and research.</sub>
</div>
