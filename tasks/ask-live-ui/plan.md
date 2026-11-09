# Plan: live process on /ask + broken answer UI

## Overview
Two user complaints (screenshots, 2026-11-09):
1. Ask page shows only "Searching the library… / Agent active" during a run. User wants thinking,
   process, tool calls, documents found.
2. Answer UI looks broken: source chips are huge wrapped pills with full filenames; StepWalkthrough
   renders title column squeezed, cite chip overflowing, "Unpack step" button text stacked vertically.

## Root causes (verified by reading code / live repro)
- **Live process:** `useAskData` opens the SSE `EventSource` only when session detail
  `status === 'thinking'`. `useSendMessage.send()` seeds the cache with the idle `created` session
  (fresh 30s) and awaits a blocking POST, so detail is never refetched and SSE never opens.
- **Steps carry no results:** tools emit only "doing X…" text; nothing about what was found.
- **Chips:** `.sources a` / `.uiCiteChip` have no max-width/ellipsis; `sourceLabel` uses full
  filename + page + section. `.stepHead` is a non-wrapping flex row; `.stepAskBtn` can shrink, so
  its text wraps per character when a long nowrap cite chip eats the width.

## Decisions
- Frontend subscribes to SSE while a send is in flight (no backend change for the subscription).
- Step events become structured: `{text, tool?, found?: [{book,page,section}]}`; `thought_steps`
  stays `list[str]` for persistence/back-compat (text only), live payload adds `detail`.
- Chips: truncate with ellipsis + `title` tooltip, short label = clean book title.

## Tasks
See `todo.md`. Order: UI CSS fixes (small, independent) -> SSE subscription -> structured step
detail -> render in process card -> live verification.

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Race: SSE opens before server sets "thinking" | Med | events route sends initial status; subscribe while `sending`, not only `thinking` |
| Hub drops events emitted before subscribe | Med | emit buffered `steps` cumulatively (already in payload) |
| Persisted `thought_steps` schema change | Low | keep list[str]; detail live-only |
| Model without reasoning stream shows nothing for "thinking" | Low | show tool/step timeline regardless |

## Open questions
- None blocking.
