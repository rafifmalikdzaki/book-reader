# Project Context

Local single-user reading and research app for a personal PDF/Markdown library.
FastAPI server, Python 3.12 via uv. The UI is a React SPA in `frontend/` (Vite build),
served by FastAPI from the generated `static/app/` bundle.

## Stack

- FastAPI, PyMuPDF, PageIndex Flash (optional), Elasticsearch (optional)
- React 19 + Vite + TypeScript (strict) SPA in `frontend/`, built to `src/book_reader/static/app/` (gitignored)
- UI libraries: `@base-ui/react` for unstyled a11y primitives (Button, Dialog, Select, Tabs, Menu — wrapped in `frontend/src/ui/`, styled via CSS Modules + `styles/tokens.css`); beautiful-ui primitives (MIT, `slev12397/beautiful-ui`) ported into `frontend/src/features/chat-render/agent/` (AgentTrace, TaskRows, ContextCards, PromptBar); `react-pdf` v11 with vendored pdfjs for the reader; vendored KaTeX for math; `@tanstack/react-query`, `react-router-dom`, `zod`, `@openuidev/react-lang` for OpenUI blocks; `@radix-ui/react-toast` + `@radix-ui/react-visually-hidden` remain for toasts/a11y
- `react-pdf` v11 (`pdfjs-dist` 6.x) native React PDF viewer; local CMap/font assets and KaTeX 0.19.1 vendored under `src/book_reader/static/vendor/`
- LangGraph/LangChain chat with Mistral, Inception, OpenRouter, or Ollama
- State is plain JSON in a state directory; one process owns it at a time.

## Commands

```bash
just ci                         # Complete quality gate: Python check/test + Frontend check/test/build
just check                      # Run all linters and typecheckers (Python + TypeScript)
just test                       # Run all test suites (pytest + vitest)
just fmt                        # Auto-format codebase (ruff + autofix)
just run                        # Start local book-reader server
just dev-ui                     # Vite dev server, proxies /api etc. to 127.0.0.1:8000
just eval-offline               # Run Ask + OpenUI eval suite
just gen-prompt                 # Regenerate the OpenUI system prompt from the frontend library
just check-prompt               # Fail if the committed OpenUI prompt is stale (part of ci)
just eval-live                  # Run Ask eval live against inception:mercury-3
just vendor-pdfjs               # Vendor PDF.js
just vendor-katex               # Vendor KaTeX
```

## Architecture invariants

- A book's stable identity is its SHA-256 content hash in `library_manifest.json`.
  Reading positions, notes, page counts, sections, categories, and move redirects
  follow that identity across renames and folder moves.
- State changes use the shared state lock. A reindex takes a backup, writes a
  transaction marker, remaps stores, commits the manifest/redirects, then clears
  the marker. A failure rolls every store back; a crash recovers on next sync.
- Auto-organize writes `categories.json` only. It never moves library files.
- The UI is a React SPA served by FastAPI: `GET /`, `/ask`, `/book/{rel}` and `/design`
  return `static/app/index.html`. There is no legacy Jinja fallback. Moved-book 307
  redirects stay server-side and run before the SPA shell. Hashed
  `/static/app/assets/*` are immutable; `index.html` is `no-cache`. A missing bundle
  gives a 503 that points at `scripts/build_frontend.sh`.
- The PDF surface is a native React 19 viewer (`react-pdf` v11) with windowed canvas
  virtualization, toolbar, outline/thumbnail rail, in-book search, deep links,
  selection notes, and Ask context (`ADR-007`).
- Reader Ask stays a resizable side panel (expandable up to 50% viewport width).
  Home Ask is `/ask`, a library-wide workspace with persistent sessions, category-scoped
  retrieval, and projects. Chat sessions expire after seven days unless pinned or
  assigned to a project.
- Chat model preferences and reasoning effort options (`/api/chat/options`,
  `chat_model`, `chat_effort`) persist across sessions.
- Ask steering is modular: `chat/guidance.py` picks at most two modules from
  `skills/steering/*.md` from the last user message (deterministic regex, no model call) and
  binds only their tools. Unmatched questions keep every read-only tool; `add_note` is offered
  only for note questions. Grow a module instead of growing `core.md`. Generation tracks step
  progress and thought traces, storing `thought_steps` directly in session message state.
- Text state (notes, progress, categories, chat book/source contexts) is
  content-addressed and portable.
- Zotero (`zotero/`) is read-only: `zotero.sqlite` is opened immutable and matched to
  books by attachment md5, filename, arXiv id/DOI, then title. Never write to it, never
  store its data in the state dir; it is re-read when the database changes.
- Paper import (`papers/`) is the only code that fetches from the network on the user's
  behalf and the only code that adds a file to the library (`Papers/`, never overwriting).
  Keep every download behind `PaperFetcher`'s checks (https, public address, redirect
  re-validation, connection pinned to the checked address, size cap, PDF magic).
  Metadata lives in the PDF's own Info dictionary,
  not in a state store. Tests use `httpx.MockTransport`; none may reach the network.

## Decision records

`docs/decisions/` records why the SPA cutover, vendored reader assets,
content-hash reindex, and localhost/file-serving boundary work this way. Add a
new numbered ADR when changing one of those decisions; do not rewrite old ones.

## Editing boundaries

- Never commit `.env`, API keys, state directories, or generated library data.
- Do not add an auth or multi-tenant story; the app is localhost-only by design.
- Do not replace PDF.js or KaTeX with CDN URLs; assets stay local. Do not bundle them via
  npm either: they stay vendored under `static/vendor/`.
- `/raw` serves only PDF, Markdown, and raster images inline. Every other library file is
  `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`, so an
  HTML/SVG file cannot execute on the app origin. Precompressed static responses must stay
  inside the static root after symlink resolution.
- Do not hand-edit `src/book_reader/static/app/`; it is generated by `frontend/` and
  gitignored. Style with the tokens in `frontend/src/styles/tokens.css`, not raw hex.
- Adding a new state store means it participates in the reindex transaction,
  backup list, and shared lock.
- Backend code is grouped by feature (`state/`, `library/`, `reading/`, `notes/`, `search/`,
  `chat/`, `organize/`, `reindex/`, `api/`; ADR-009). Domain packages must not import
  `fastapi`, `api/` or `services.py`, and `chat/__init__.py` stays empty so the optional
  LangChain imports stay lazy.
- Keep tests deterministic and add only behavior-level coverage.
