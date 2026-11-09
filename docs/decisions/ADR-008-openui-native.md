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
   `BOOK_READER_OPENUI_FORMAT` chooses what the model is asked to write: `json` (default, see
   the live gate below) or `lang`.
5. **Supply chain.** The packages are exact-pinned and installed with `ignore-scripts=true`
   (`frontend/.npmrc`): `@openuidev/lang-core` has a telemetry postinstall script. Runtime
   telemetry is opt-in and not enabled; the CLI is run with `--no-telemetry`.

## Consequences

- Bundle size: JS in `static/app/assets` grew from 1,131,545 to 1,328,065 bytes (+196,520 raw)
  with the Renderer, Zod and `lang-core`.
- **Live gate (2026-11-09): failed, so the default stays `json`.** `just eval-live` ran the six
  default cases against each provider with the same prompt machinery in both formats. Bar:
  >=90% valid blocks on the primary, >=70% on fallbacks. Share of cases with a valid block
  (checked by `evals/openui_lang.py` for Lang, the JSON validator for JSON):

  | Model | OpenUI Lang | JSON |
  | --- | --- | --- |
  | `inception:mercury-3` (primary) | 5/6 | 5/6 |
  | `mistral:mistral-small-latest` | 1/6 | 5/6 |
  | `mistral:ministral-8b-latest` | 0/6 | 4/6 |
  | `ollama:gpt-oss:20b` | 1/6 | 6/6 |
  | `mistral:zai-glm-5-3-flash` | 6/6 | 6/6 |
  | `openrouter:openrouter/free`, `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` | not measured | not measured |

  The two OpenRouter free models could not be measured: the account hit its free-tier daily
  quota (429) and the router returned 502/504 errors, in both formats.

  A second Lang run after adding an explicit "arguments are positional, never `title = ...`"
  rule and a single-line rule to the prompt did not help (mercury-3 4/6, mistral-small 2/6,
  ministral-8b 0/6, gpt-oss 2/6, glm 6/6), so that change was reverted. The models keep writing
  keyword arguments despite the instruction.

  Nearly every Lang failure was the same mistake: the model wrote named arguments
  (`ConceptCard(title = "...", intuition = "...")`) although the prompt forbids it. The
  primary's single miss (`step_walkthrough`, no block at all) is identical in both formats.
  Answers were not replayed through the browser Renderer, so the Lang counts come from the
  Python checker and may differ from the Renderer on edge cases. Revisit by changing the generated prompt (for
  example a rule and examples that show positional-only calls) and rerunning `just eval-live`
  per model; flip `DEFAULT_OPENUI_FORMAT` when the bar is met.
- **Removal date for the legacy path:** once chats written before 2026-11-09 have expired
  (retention is 7 days, so after 2026-11-16 plus a release of margin), delete `legacyJson.ts`,
  the `json` branch of `OpenUIBlockView`, the JSON auto-detection in `markdown.ts`, the JSON
  prompt in `chat/prompts.py` and the flag.
- **Per-model format.** `src/book_reader/models.json` records, per model, the format it is asked
  to write; all models are `json` today because none passes the bar for `lang` except
  `zai-glm-5-3-flash` (6/6 in two runs, kept on `json` until a Renderer replay of its answers
  confirms it). A replay of the top three models' JSON answers (mercury-3, gemini-3.8-flash,
  mistral-small) through the real renderer matched the Python validator: 17 of 18 blocks
  rendered, the failure being mistral-small's `ConceptCard`.
- Reordering props in a Zod schema changes the positional wire format; regenerate the prompt and
  expect model behaviour to shift.
