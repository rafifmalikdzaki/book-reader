# Book Reader Task Runner (Justfile)
# Run `just` or `just --list` to display all available commands.

set shell := ["bash", "-uc"]

# Default: display help list of available recipes
default:
    @just --list --unsorted

# ---- Quality Gates & CI ---------------------------------------------------

# Run full project quality gate (Python format/lint/types/tests + Frontend lint/types/tests/build)
ci: check-py test-py check-ui test-ui build-ui
    @echo "✅ All CI quality gates passed cleanly."

# Run all static checks across Python and Frontend
check: check-py check-ui
    @echo "✅ All linting and type checks passed."

# Run all test suites across Python and Frontend
test: test-py test-ui
    @echo "✅ All Python and Frontend tests passed."

# Auto-format all Python and Frontend source files
fmt: fmt-py
    @echo "✅ Codebase formatted."

# ---- Python Tasks ---------------------------------------------------------

# Check Python formatting, linting, and types (ruff + mypy)
check-py:
    uv run ruff format --check src tests scripts
    uv run ruff check src tests scripts
    uv run mypy src tests

# Auto-format and fix Python code (ruff format + ruff check --fix)
fmt-py:
    uv run ruff format src tests scripts
    uv run ruff check --fix src tests scripts

# Run Python unit & integration tests with pytest
test-py *args="":
    uv run pytest -q {{args}}

# Run Ask + Socratic Tutor + OpenUI offline evaluation suite
eval-offline:
    uv run python scripts/eval_ask.py

# Run Ask evaluation live against inception:mercury-3
eval-live model="inception:mercury-3":
    uv run python scripts/eval_ask.py --live --model {{model}}

# Benchmark retrieval accuracy against your local book collection
benchmark-rag library="~/Documents/Books":
    uv run python scripts/benchmark_rag.py --library {{library}}

# ---- Frontend Tasks -------------------------------------------------------

# Clean install frontend dependencies with npm ci
install-ui:
    cd frontend && npm ci

# Run frontend ESLint and TypeScript strict typecheck
check-ui:
    cd frontend && npm run lint && npm run typecheck

# Run frontend Vitest test suite
test-ui *args="":
    cd frontend && npm test {{args}}

# Build the production React 19 SPA bundle into src/book_reader/static/app
build-ui:
    cd frontend && npm run build

# Start the Vite development server with API proxying
dev-ui:
    cd frontend && npm run dev

# ---- Application & Server -------------------------------------------------

# Start the local Book Reader application server
run *args="":
    uv run book-reader {{args}}

# Sync Python environment dependencies
sync:
    uv sync --locked

# Vendor local PDF.js assets into src/book_reader/static/vendor/
vendor-pdfjs:
    uv run python scripts/vendor_pdfjs.py

# Vendor local KaTeX assets into src/book_reader/static/vendor/
vendor-katex:
    uv run python scripts/vendor_katex.py
