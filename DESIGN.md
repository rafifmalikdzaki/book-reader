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
  borderless blocks with an expandable "Research & reasoning" trace (SVG bulb icon) and
  citation chips under the answer (`chat-render/`).
- **Process card** — the live agent run: spinner + headline + mono elapsed chip, expandable
  task rows (check / pulse-dot SVG icons), found passages, model reasoning (`ProcessCard`).
- **Prompt bar** — rounded bar (`--radius-lg`, `--paper-lit`, brass focus-within ring) with
  borderless textarea and send action; teaching mode is a segmented pill control
  (Explain / Socratic Tutor) with the active segment filled brass.
- **Sessions rail** — quiet list with uppercase group labels, brass inset marker on the
  current chat, tabular-numeral timestamps, pulse-dot on thinking sessions.
- Icons are inline SVG (`features/chat-render/icons.tsx`); no emoji or unicode glyphs.
- Motion: spinner + pulse only, both disabled under `prefers-reduced-motion`.

Everything outside `.ask-console` keeps the reading-room world unchanged.
