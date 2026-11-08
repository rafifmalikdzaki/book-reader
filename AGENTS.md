# Project Context

Local single-user reading and research app for a personal PDF/Markdown library.
FastAPI + Jinja server, Python 3.12 via uv, no frontend build step.

## Stack

- FastAPI, Jinja2, PyMuPDF, PageIndex Flash (optional), Elasticsearch (optional)
- PDF.js 6.5.438 and KaTeX 0.19.1, vendored under `src/book_reader/static/vendor/`
- LangGraph/LangChain chat with Mistral, Inception, OpenRouter, or Ollama
- State is plain JSON in a state directory; one process owns it at a time.

## Commands

```bash
uv sync
uv run book-reader --library ~/Documents/Books --port 8000
uv run pytest -q
./scripts/ci.sh                 # format, lint, mypy strict, tests
uv run python scripts/vendor_pdfjs.py
uv run python scripts/vendor_katex.py
```

## Architecture invariants

- A book's stable identity is its SHA-256 content hash in `library_manifest.json`.
  Reading positions, notes, page counts, sections, categories, and move redirects
  follow that identity across renames and folder moves.
- State changes use the shared state lock. A reindex takes a backup, writes a
  transaction marker, remaps stores, commits the manifest/redirects, then clears
  the marker. A failure rolls every store back; a crash recovers on next sync.
- Auto-organize writes `categories.json` only. It never moves library files.
- The PDF surface is an iframe of the vendored PDF.js viewer. `pdf_reader.js`
  bridges page progress, deep links, selection notes, Ask context, and resize.
- Reader Ask stays a resizable side panel. Home Ask is `/ask`, a library-wide
  workspace with persistent sessions, category-scoped retrieval, and projects.
  Chat sessions expire after seven days unless pinned or assigned to a project.
- Text state (notes, progress, categories, chat book/source contexts) is
  content-addressed and portable. Zotero is not integrated; the content hash is
  the intended future join key.

## Editing boundaries

- Never commit `.env`, API keys, state directories, or generated library data.
- Do not add an auth or multi-tenant story; the app is localhost-only by design.
- Do not replace PDF.js or KaTeX with CDN URLs; assets stay local.
- Adding a new state store means it participates in the reindex transaction,
  backup list, and shared lock.
- Keep tests deterministic and add only behavior-level coverage.
