# ADR-002: Keep PDF.js and KaTeX vendored and lazy

## Status

Partially superseded by [ADR-007](ADR-007-react-pdf-viewer.md) (PDF viewer surface moved from iframe to native React `react-pdf` v11; local KaTeX and vendored CMap/font assets remain active)

## Date

2026-11-08

## Context

The reader must work offline from a localhost server and must not depend on a
third-party CDN. PDF.js supplies selection, search, outline, zoom, print, and the
native viewer surface. KaTeX renders model answers and is unnecessary until a
chat answer contains mathematics.

The SPA still needs reader-side progress, deep links, selection-to-note, and Ask
context. Rebuilding PDF.js inside the application bundle would duplicate and
potentially fork the viewer, while a postMessage-only integration would require a
larger custom viewer layer.

## Decision

Keep PDF.js 6.5.438 and KaTeX 0.19.1 as version-pinned assets under
`src/book_reader/static/vendor/`. The PDF reader embeds the vendored
`viewer.html` in a same-origin iframe and reaches
`contentWindow.PDFViewerApplication` from `frontend/src/features/reader-pdf/`.
The bridge owns progress, URL hashes, initial-page jumps, selection capture,
notepad composition, the viewer CSS injection, and resize updates.

Load KaTeX only when a chat answer/panel needs it, from
`/static/vendor/katex/`, using `trust:false`, bounded `maxSize` and
`maxExpand`, and text-node rendering. Do not import either package from npm and
do not use CDN URLs.

## Alternatives Considered

### Import PDF.js through npm and wrap it in React

Rejected: it would replace the maintained viewer UI and require rebuilding
selection, find, outline, print, and accessibility behavior that the vendored
viewer already provides.

### Use a cross-origin iframe with postMessage only

Rejected: the same-origin reach-in is the smallest compatible bridge for the
viewer's event bus and selection state, and the viewer is served by the same
trusted FastAPI process.

### Load KaTeX eagerly with the application bundle

Rejected: math is rare relative to page loads; the lazy loader keeps 294 KB of
JS/CSS off the library and reader entry path.

## Consequences

- PDF.js/KaTeX upgrades are deliberate vendor-script changes, not npm semver
  upgrades; the pinned versions and vendor scripts are part of the product.
- The iframe requires `frame-src 'self'`; the viewer has its own meta CSP.
- The React bridge must be exercised in a real browser, not only jsdom, because
  PDF.js timing and the iframe document are browser behaviors.
- A failed KaTeX load leaves raw LaTeX readable rather than failing the answer.
