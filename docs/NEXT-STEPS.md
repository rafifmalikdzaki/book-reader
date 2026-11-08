# Next steps

## Checkpoint

- Last verified commit: `989a2ac` (OpenRouter free models tested; gate green locally;
  CI for this commit is the push that delivered this plan).
- Gate: `./scripts/ci.sh` → 46 tests, ruff clean, mypy strict clean.
- Chat providers verified end to end: `mistral-small-latest`, `ministral-8b-latest`,
  `zai-glm-5-3-flash` (Mistral API), `mercury-3`, `gpt-oss:20b` (Ollama), and
  OpenRouter free models (`openrouter/free` 31 s, `nvidia/nemotron-3-ultra-550b-a55b:free`
  10 s, both with page-level sources).
- Retrieval benchmark: PageIndex hybrid hit@1 1.00, MRR 0.95, 9.4 ms; ES 0.90 / 0.78 / 24 ms;
  local scan 0.20 / 0.20 / 213 ms (`scripts/benchmark_rag.py`).
- Known constraints: OpenRouter free tier is rate-limited and some free models return
  504; PageIndex extraction costs ~10 s per book on first access; Elasticsearch is optional.

## Phase 1 — Chat UX (P1)

1. **Streaming answers.** Add `POST /api/chat/stream` (SSE) that emits tool-activity
   events and answer deltas; the panel renders partial text and a "searching …" line.
   Acceptance: first token under 2 s p50 on `mistral-small-latest`; sources arrive last;
   the non-streaming route stays for API clients.
2. **Conversation persistence.** Store transcripts in `chat_sessions.json`, restore on
   reload, add a "New chat" control, and cap history at 50 messages server-side.
   Acceptance: reload restores the transcript byte-for-byte; the cap truncates oldest turns.
3. **Cancel in flight.** AbortController in the panel, request cancellation server-side.
   Acceptance: aborted request writes no partial answer and does not record progress.

## Phase 2 — RAG quality (P1)

1. **Golden set expansion.** Move the 10 questions into `scripts/golden/<book>.json` and
   grow to 30 questions across five books with page, section keyword, and answer span.
   Acceptance: benchmark prints a per-question table plus the aggregate row; misses list
   the returned pages.
2. **Citation verification.** After an answer, check quoted spans appear in the cited
   page or line range; return `verification: {supported, unsupported}`.
   Acceptance: a deliberately wrong citation is reported as unsupported in a test.
3. **Note-aware retrieval.** Add a `search_notes` tool so saved passages and annotations
   become context; expose group selection in the chat panel.
   Acceptance: a question answered only from a note returns that note's source anchor.
4. **Retrieval regression gate.** Bundle a 3-page fixture PDF with synthetic sections and
   assert hit@1 ≥ 0.8 in pytest, keeping the real-library benchmark out of CI.
   Acceptance: the gate fails if ranking regresses to local-scan quality.

## Phase 3 — Search and operations (P2)

1. **Incremental reindex.** On book open, compare mtime with `search_index.json` and
   enqueue a background reindex for changed books.
   Acceptance: editing a Markdown file updates search within one request cycle.
2. **Health detail.** `/api/healthz` reports ES reachable/indexed, PageIndex availability,
   cached section count, and the chat provider chain.
   Acceptance: the compose healthcheck uses the detailed route and stays green.
3. **Structured logs.** JSON logs with request id; warn on retrieval > 250 ms.
4. **ES tuning.** Compare `best_fields` vs `most_fields` and chunk-length normalization
   in the benchmark; promote the winner.

## Phase 4 — Notepad (P2)

1. `PATCH /api/notepad/groups/{id}` rename endpoint and inline rename in the drawer.
2. Scoped export: `?book=` and `?page=` filters on the AI-context export.
3. Drag notes between groups with a keyboard-only alternative.

## Phase 5 — Release engineering (P2)

1. `CHANGELOG.md` with a `0.2.0` entry (Added/Changed/Fixed) and a `v0.2.0` tag; expose
   `/api/version` derived from the tag.
2. GitHub release job publishing the container image to `ghcr.io` on tags.
3. Coverage gate (`pytest-cov`, ≥ 80% on `src/`).
