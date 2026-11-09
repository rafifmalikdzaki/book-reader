# ADR-007: Native React 19 PDF Viewer with Windowed Canvas Rendering

## Status

Accepted (supersedes the iframe PDF viewer surface in [ADR-002](ADR-002-vendored-reader-assets.md))

## Date

2026-11-09

## Context

`ADR-002` embedded Mozilla's standalone `viewer.html` inside a same-origin `<iframe>` and bridged state through `contentWindow.PDFViewerApplication` polling (`watchFrame.ts`, `bindViewer.ts`, `usePdfBridge.ts`). While functional, the iframe boundary introduced:

1. Asynchronous polling loops (`100ms` retries up to 80 ticks) to detect viewer readiness and page initialization.
2. Separate DOM, CSS, and event trees requiring stylesheet injection (`pdf_room.css`), coordinate translation across iframe bounds, and manual sidebar suppression timers (`0, 250, 750, 1500ms`).
3. UI inconsistency between the Markdown reader (`MarkdownReader`) and the PDF reader, which could not share the application's native left-docked resizable `<Rail>` (`ContentsPortal`) or design tokens (`tokens.css`).

With `react-pdf` v11 (`pdfjs-dist` 6.x) supporting React 19 natively, we can render PDF canvases, text layers, and annotation layers directly in the React component tree while still serving the Web Worker, CMaps, standard fonts, and WASM decoders from localhost without any external CDN.

## Decision

Replace the `<iframe>` PDF surface in `frontend/src/features/reader-pdf/` with a pure React 19 viewer built on `react-pdf` v11:

1. **Windowed Continuous Scroll**: Render lightweight `.page[data-page-number]` layout slots for all pages (`1..numPages`) sized from the document's intrinsic page dimensions and active zoom mode (`page-width`, `page-fit`, or explicit scale). Mount `<Page>` canvases and text layers only for pages within `±OVERSCAN` of the active viewport page so 1,000+ page books maintain bounded canvas memory.
2. **Native Reader Chrome & Left Contents Rail**: Provide a native React toolbar (`PdfToolbar`) for page scrubbing, zoom presets, clockwise rotation, in-document text search, and fullscreen mode. Render the document outline (`pdf.getOutline()`) and page thumbnails inside the shared left-docked `<ContentsPortal>` resizable `<Rail>`.
3. **In-Document Search & Highlighting**: Extract and cache page text lazily from `PDFDocumentProxy`, stepping across matches and highlighting active terms in the text layer via `customTextRenderer`.
4. **Local-Only Assets**: Configure `pdfjs.GlobalWorkerOptions.workerSrc` via local Vite asset bundling (`'self'`) and point `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` to `/static/vendor/pdfjs/web/`. No remote CDNs are contacted.
5. **Preserved Reader Contract**: Keep `#p<n>` deep-link precedence, `ownHashes` router loop prevention, 250ms debounced progress persistence (`postProgress`), `BookContext` synchronization for Ask/Tutor, and the `#note-capture` selection-to-note bubble (`compose`).

## Consequences

- Eliminates iframe polling, cross-document event listeners, and injected iframe stylesheets.
- Unifies the Contents rail (`Outline` + `Thumbnails`) and theme tokens (`Daylight`, `Dimmed`, `Midnight Baize`) across PDF and Markdown readers.
- Keeps `/static/vendor/pdfjs/web/` in place for local CMaps, standard fonts, WASM decoders, and existing backend route tests.
