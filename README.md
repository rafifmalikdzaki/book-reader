<div align="center">

# 📖 Book Reader

<p align="center"><strong>A local-first reading room and pedagogical research workspace for your PDF and Markdown collection.</strong></p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-how-it-works">How It Works</a> ·
  <a href="#-interactive-generative-ui-openui">Generative UI</a> ·
  <a href="#-deep-retrieval--search">Deep Retrieval</a> ·
  <a href="#-your-keys-your-data">Your Keys, Your Data</a> ·
  <a href="#-development">Development</a> ·
  <a href="#-architecture--api">Architecture</a>
</p>

[![CI](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/rafifmalikdzaki/book-reader/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116+-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=flat&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Local-First](https://img.shields.io/badge/Local--First-Zero_Telemetry-8A6D3B?style=flat)](#-your-keys-your-data)

</div>

Book Reader turns any local folder of textbooks, research papers, and technical notes into a quiet, distraction-free reading room.

Instead of passive skimming or shallow RAG summaries that truncate after 500 tokens, Book Reader reads multi-page mathematical proofs, verifies claims against grounded citations, and actively teaches one reasoning step at a time. It pairs a native React 19 PDF viewer and CommonMark reader with anchored marginalia, a Jane Street Socratic Tutor, and question-adaptive Generative UI.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BOOK READER PLATFORM                            │
├───────────────────┬───────────────────┬───────────────────┬─────────────────┤
│ 📚 Library & Shelf│ 📄 Reader Surfaces│ 📝 Notepad System │ 🎓 Pedagogical  │
│   • Cover previews│   • React-PDF v11 │   • Anchored notes│    AI Teacher   │
│   • Reading modes │   • Windowed scroll│  • Multi-span loc│   • Explain Mode│
│   • Move tracking │   • Markdown AST  │   • Markdown /    │   • Socratic    │
│   • Virtual cats  │   • KaTeX math    │     JSON export   │     Tutor Skill │
└───────────────────┴───────────────────┴───────────────────┴─────────────────┘
```

---

## ⚡ How It Works

1. **Read & Anchor.** Open books in a native React 19 PDF viewer (`react-pdf` v11) with windowed canvas virtualization, table of contents outline, thumbnail strip, and in-document text search (`<mark>` highlights). Select any passage in PDFs or Markdown notes to anchor marginalia to exact character offsets or source lines.
2. **Decompose & Diagnose.** The Socratic Tutor decomposes target chapters into 4–8 concrete subskills. Before lecturing, it runs a 3–5 question placement diagnostic **one question at a time** to discover where your understanding ends.
3. **Teach & Probe.** Master Teacher mode explains with Intuition → Formal Equations → Worked Examples with deep locators (`paper.pdf#p14`). Socratic Tutor mode probes misconceptions, plays devil's advocate on correct answers, and never lectures passively.
4. **Inspect the Thinking.** Real-time reasoning effort controls (`Low`, `Medium`, `High`) and live process tracking. Watch the agent track subtasks, extract multi-page section spans, and stream its internal reasoning traces before finalizing the response. Completed answers preserve the exact sequence in a collapsible research trace.
5. **Carry Forward.** Move files, rename folders, or reorganize your filesystem in your OS without fear. Stable SHA-256 content hashes ensure reading positions, notes, and chat sessions follow your documents wherever they move.

**Half-Page Expandable Rails.** Slide-out Ask and Table of Contents side rails dynamically expand up to 50% of the viewport width for comfortable, side-by-side technical study.

**Reading Atmospheres.** Switch effortlessly between *Daylight Lamp*, *Dimmed Desk*, and *Midnight Baize* nocturnal themes without jarring reloads.

---

## 🎨 Interactive Generative UI (OpenUI)

Instead of dense walls of raw text, responses render tailored components from a typed library, written by the model in [OpenUI Lang](https://github.com/thesysdev/openui) and rendered progressively by the official `@openuidev/react-lang` Renderer while the answer streams. The component library (`frontend/src/features/chat-render/openui/library.tsx`) is the single source of truth: the system prompt is generated from it (`just gen-prompt`) and committed, so a Python-only install needs no Node. Answers stored before the migration (JSON `openui` blocks) still render. Set `BOOK_READER_OPENUI_FORMAT=json` to make the model emit the legacy JSON blocks instead.

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

---

## 🔍 Deep Retrieval & Search

Unlike standard RAG pipelines that truncate text after a single page:
- `get_book_outline(book)` inspects the complete PageIndex Flash layout tree or Markdown heading hierarchy.
- `read_section(book, section)` extracts multi-page section spans (up to 10 pages / 10,000 characters) so mathematical proofs and derivations are never cut off.
- `list_books(query, category)` scans the library with cached human-readable PDF titles.
- `read_notes(book, query)` pulls your saved thoughts into the reasoning loop.

Book Reader supports hybrid multi-tier retrieval configured via `--search`:

| Mode | Strategy |
| :--- | :--- |
| **`auto`** *(default)* | Elasticsearch BM25 when reachable, then PageIndex section trees, falling back to local text scan |
| **`pageindex`** | Vectorless hierarchy search over offline PageIndex Flash layout trees; no external services |
| **`elastic`** | Pure Elasticsearch BM25 full-text chunk search |
| **`local`** | Fast candidate-scored in-process text scan |

---

## 🚀 Quick Start

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

## 🔒 Your Keys, Your Data

- **Localhost by design.** Single-user, zero telemetry, no external analytics, no cloud subscriptions. Runs bound to `127.0.0.1` by default with DNS rebinding host protection.
- **Vendored & offline assets.** PDF rendering worker, CMaps, standard fonts, and KaTeX math fonts are served locally from `static/vendor/` with zero remote CDN dependencies.
- **Your models, your keys.** Direct API integration with Inception Mercury 3, Mistral, OpenRouter, or 100% offline local [Ollama](https://ollama.com/) instances for private, network-free document analysis.
- **Crash-proof storage.** Plain JSON state files with transactional file locks, pre-write atomic backups, and automatic crash recovery on startup.
- **Sandboxed untrusted content.** User-authored Markdown HTML execution is disabled. Arbitrary files served via `/raw` are served as forced attachments with `nosniff`.

---

## 🛠️ Development

We use [`just`](https://github.com/casey/just) for streamlined local automation:

```bash
# Complete quality gate: Python check/test + Frontend check/test/build
just ci

# Run all linters and typecheckers (Ruff + Mypy + ESLint + TypeScript)
just check

# Run all test suites (182 Python pytest + 194 Frontend vitest)
just test

# Auto-format codebase (ruff format + autofix)
just fmt

# Run Ask + Socratic Tutor evaluation suite (offline or live Mercury 3)
just eval-offline
just eval-live

# Benchmark retrieval accuracy against your collection
just benchmark-rag

# Dev server with HMR (proxies API to localhost:8000)
just dev-ui
```

*(You can also run commands directly with `uv run ...` and `npm run ...` if `just` is not installed.)*

---

## 🏗️ Architecture & API

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
│  │ Native PDF/MD View │ /ask Workspace     │ OpenUI Block Renderer  │  │
│  └────────────────────┴────────────────────┴────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

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
| `/api/chat/options` | `GET` / `POST` | Inspect or update active chat model and reasoning effort settings |
| `/api/notepad` | `GET` / `POST` / `PATCH` | Notes, groups, and AI-context export (`format=json\|markdown`) |
| `/api/library/reindex` | `POST` | Content-hash reconciliation and move redirection |

---

<div align="center">
  <sub>Built for focused, long-form technical reading and research. Free and open forever.</sub>
</div>
