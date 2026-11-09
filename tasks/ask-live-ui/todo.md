# Ask live process + UI fixes

Plan: `tasks/ask-live-ui/plan.md`

## Phase 1: UI breakage (independent, S)
- [x] T1: Source chips (`ChatRender.module.css .sources a`, `links.ts sourceLabel`): max-width,
      ellipsis, `title` tooltip. AC: 100-char filename stays one line; test on SourceList.
- [x] T2: StepWalkthrough layout (`OpenUI.module.css .stepHead/.stepMeta/.stepAskBtn/.uiCiteChip`):
      head wraps, button `white-space: nowrap; flex-shrink:0`, cite chip ellipsis. AC: no
      vertical text at 390px and 1440px; browser screenshot check.
- [x] Checkpoint: vitest/tsc/eslint green (no browser screenshot: extension not connected).

## Phase 2: live stream (M)
- [x] T3: `useAskData` takes `sending`; refetch 1s + open EventSource while thinking||sending.
      AC: AskPage test with mocked EventSource shows steps before POST resolves.
- [x] T4: Backend step detail: tools emit `found` docs (book/page/section) via on_step payload;
      route emits `step` events with `detail`. AC: pytest on tool-found payload + SSE.
- [x] T5: Process card renders tool timeline with found-document chips + reasoning stream.
      AC: component test; collapses into `.thoughtTrace` after done.
- [x] Checkpoint: pytest 224, vitest 249, mypy, ruff, tsc, eslint green.

## Phase 3: verify
- [x] T6 (HTTP only): Restart server, run capability tour in browser, confirm live steps/docs/reasoning;
      screenshots.
