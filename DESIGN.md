# DESIGN.md — visual system

The app has one established world — the **reading room** (see
`.impeccable/surfaces/src-book-reader-templates-index-html.md`): lamp-lit baize shell,
brass accent, warm paper, Source Serif 4 for display, Public Sans for controls. Global
tokens live in `frontend/src/styles/tokens.css`; components must use those variables, never
raw hex.

## Ask console (scoped exception)

The two Ask surfaces — the `/ask` workspace (`frontend/src/features/ask/`) and the reader
chat rail (`frontend/src/features/chat-rail/`) — use the beautifului.dev AI-native
**component language** (thinking trace, task rows, source chips, prompt bar) so a later
adoption of those React components is a drop-in replacement, not a restyle. The
`.ask-console` class in `tokens.css` is a structural hook only: colors follow the Lamp
toggle like the rest of the app (light = reading-room paper, midnight = dark baize). See
`.impeccable/surfaces/frontend-src-features-ask-askpage-tsx.md` for the direction
contract.

Component language inside the console:

- **Transcript** — user turns are brass bubbles (right-aligned); assistant turns are
  borderless blocks with an expandable "Research & reasoning" trace and citation cards
  under the answer (`chat-render/`).
- **Live process card** — tool steps as capsule task rows (spinner ring → check badge,
  status pills), found passages as context cards (`ProcessCard`).
- **Prompt bar** — window-radius bar with hairline ring + layered shadow, brass focus
  ring, borderless auto-growing textarea, circular brass send action; teaching mode is a
  segmented pill control (Explain / Socratic Tutor) above it.
- **Sessions rail** — quiet list with uppercase group labels, brass inset marker on the
  current chat, tabular-numeral timestamps, pulse-dot on thinking sessions.
- Icons are inline SVG (`features/chat-render/icons.tsx`); no emoji or unicode glyphs.
- Motion: spinner, shimmer header text, fade-up row entrances, all under
  `prefers-reduced-motion` (global kill switch in `tokens.css`).

The agent primitives in `frontend/src/features/chat-render/agent/` are ports of the
beautiful-ui primitives (MIT, `github.com/slev12397/beautiful-ui`):
`AgentTrace` ← ThinkingState, `TaskRows` ← TaskRows, `ContextCards` ← ContextCards,
`PromptBar` ← PromptBar — structure and motion kept, Tailwind classes replaced with our
tokens/CSS modules so they follow the Lamp toggle.

Everything outside `.ask-console` keeps the reading-room world unchanged.

## Component foundation

Interactive primitives in `frontend/src/ui/` wrap **Base UI** (`@base-ui/react`,
unstyled, a11y-correct; CSS-module styling on top of our tokens):

- `Button` / `IconButton` / `LinkButton` → `@base-ui/react/button`
- `Dialog` / `ConfirmDialog` → `@base-ui/react/dialog` (focus trap, Esc, scroll lock,
  focus restore; the old `@radix-ui/react-dialog` dep is gone)
- `Select` → `@base-ui/react/select` — a real styled dropdown (arrow keys, typeahead,
  check indicator) instead of the native picker; call sites keep `<option>` children
  and a change-shaped `onChange`
- `Segmented` → `@base-ui/react/tabs` (tablist semantics, arrow-key + Enter activation)
- Lamp atmosphere menu → `@base-ui/react/menu` RadioGroup (replaced the hand-rolled
  dropdown and its emoji icons with inline SVGs)

Portal setup per the Base UI quick start lives in `reset.css` (`#root { isolation:
isolate }`, `body { position: relative }`). Toast still uses `@radix-ui/react-toast`.

