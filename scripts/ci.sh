#!/usr/bin/env bash
# Local mirror of the CI quality gate.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v just >/dev/null 2>&1; then
    exec just ci
fi

uv sync --locked
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy src tests
uv run pytest -q

cd frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
