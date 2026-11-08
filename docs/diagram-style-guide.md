# Diagram style guide — book-reader reading room

Project-local skin for Diagram Design artifacts. Derived from the app's own `:root`
tokens, not the shipped stone/rust default. One accent only.

| Role | Value |
|---|---|
| paper | `#F6F1E4` |
| paper-2 | `#FFFDF6` |
| ink | `#241E16` |
| muted | `#6B5D4A` |
| soft | `#8A7A63` |
| rule | `rgba(36,30,22,0.12)` |
| rule-solid | `#D8CBB4` |
| accent | `#B08A4A` brass |
| accent-tint | `rgba(176,138,74,0.12)` |
| link | `#7E5F2E` brass-deep |
| baize | `#1E352D` (page chrome only) |

Typography: Source Serif 4 for the title, Public Sans for names and labels,
system monospace for technical annotations. These match the app; system fallbacks
keep the artifact self-contained without a font CDN.
