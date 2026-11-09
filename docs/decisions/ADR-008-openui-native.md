# ADR-008: Render chat blocks with the official OpenUI library

## Status

Accepted

## Date

2026-11-09

## Context

Chat answers carried visual blocks (concept cards, charts, graphs, tutoring maps) in an
in-house look-alike of OpenUI: the model wrote ` ```openui ` JSON, a hand-written parser
validated it and `OpenUIBlockView` rendered it. Three definitions of the same components
(system prompt, Python eval validator, TypeScript parser) were kept in sync by hand and had
already drifted. A half-streamed block showed only a "Building X…" placeholder, an invalid block
was dumped as raw code, and three bugs fixed in review (chart scaling, negative bars, comma
repair inside strings) came from the hand-rolled parser.

## Decision

1. **Wire format is OpenUI Lang** (` ```openui-lang ` fences, positional component calls such as
   `root = Answer([card])`), rendered by `@openuidev/react-lang`'s `Renderer`. Programs render
   progressively while streaming; unknown components or bad arity surface through `onError`, and
   a closed block that still reports errors falls back to its raw source.
2. **One library, generated prompt.** `openui/library.tsx` defines the eight components with Zod
   schemas. `npm run gen:openui-prompt` (`@openuidev/cli`) generates the system prompt and a spec
   JSON into `src/book_reader/prompts/`. Both are committed so a Python-only install needs no
   Node, and `scripts/check_openui_prompt.sh` (in `just ci` and GitHub Actions) fails when they
   are stale. The Python eval checker reads argument names and arity from the spec, so there is
   no third copy.
3. **Actions stay in our code.** Buttons still call `onPrompt` through a React context with the
   same prompt strings (`AskPage` switches to tutor mode by matching them); the library's own
   action system is not used. `@openuidev/react-ui` is not used either, to keep the app's tokens.
4. **Legacy JSON keeps rendering** through `legacyJson.ts`, because chats are retained for 7 days.
   `BOOK_READER_OPENUI_FORMAT=json` makes the model emit the old format (rollback lever).
5. **Supply chain.** The packages are exact-pinned and installed with `ignore-scripts=true`
   (`frontend/.npmrc`): `@openuidev/lang-core` has a telemetry postinstall script. Runtime
   telemetry is opt-in and not enabled; the CLI is run with `--no-telemetry`.

## Consequences

- Bundle size: JS in `static/app/assets` grew from 1,131,545 to 1,328,065 bytes (+196,520 raw)
  with the Renderer, Zod and `lang-core`.
- Model compliance with OpenUI Lang is unproven until the live gate in the migration plan
  (>=90% error-free on the primary provider, >=70% on fallbacks) is run; the flag above is the
  fallback if a provider cannot follow the format.
- **Removal date for the legacy path:** once chats written before 2026-11-09 have expired
  (retention is 7 days, so after 2026-11-16 plus a release of margin), delete `legacyJson.ts`,
  the `json` branch of `OpenUIBlockView`, the JSON auto-detection in `markdown.ts`, the JSON
  prompt in `chat/prompts.py` and the flag.
- Reordering props in a Zod schema changes the positional wire format; regenerate the prompt and
  expect model behaviour to shift.
