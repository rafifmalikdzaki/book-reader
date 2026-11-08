#!/usr/bin/env bash
# Local mirror of the CI quality gate.
set -euo pipefail
cd "$(dirname "$0")/.."

uv sync --locked
uv run ruff format --check src tests
uv run ruff check src tests
uv run mypy src tests
uv run pytest -q
