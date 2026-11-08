#!/usr/bin/env bash
# Build the React SPA into src/book_reader/static/app (gitignored).
set -euo pipefail
cd "$(dirname "$0")/../frontend"

npm ci
npm run build
