#!/usr/bin/env bash
# Fail when the committed OpenUI prompt/spec no longer match the frontend component library.
# Regenerate with: cd frontend && npm run gen:openui-prompt
set -euo pipefail
cd "$(dirname "$0")/../frontend"

prompts=../src/book_reader/prompts
digest() { cat "$prompts/openui_prompt.txt" "$prompts/openui_prompt.spec.json" | sha256sum; }

before=$(digest)
npm run --silent gen:openui-prompt >/dev/null
if [ "$before" != "$(digest)" ]; then
    echo "OpenUI prompt is stale: it was regenerated from the library. Review and commit it." >&2
    exit 1
fi
