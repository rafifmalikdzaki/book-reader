#!/usr/bin/env bash
# Build the React SPA into src/book_reader/static/app (gitignored).
set -euo pipefail
cd "$(dirname "$0")/../frontend"

if [[ "${CI:-}" == "true" ]] || [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules ]]; then
  npm ci
  touch node_modules
fi
npm run build
