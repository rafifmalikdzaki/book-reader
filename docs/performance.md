# Performance ledger

Measured on the running local preview, 1440×900, loopback, warm server unless noted.

| Change | Baseline | Result | Verdict |
|---|---|---|---|
| Tile previews: PNG 360 → JPEG 300, quality 80 | 100 thumbnails ≈ 12.2 MiB; one 360 px PNG = 69.3 KB | 300 px JPEG = 30.7 KB; ~100 covers ≈ 3 MiB | keep |
| Index compression | 281.9 KB HTML, uncompressed | 36.7 KB HTML gzip | keep |
| PDF.js static assets | 4.01 MB core, no compression, revalidated | pdf.mjs 891.5 KB → 182.7 KB gzip; worker 2.25 MB → 478.3 KB; immutable vendor cache | keep |
| Chat math assets | KaTeX JS/CSS ≈ 294 KB loaded on every page | loaded only when Ask opens; absent from index resources | keep |
| Font loading | Google Fonts network requests on every page | self-hosted WOFF2, no third-party origin | keep |
| Title resolution | every PDF opened on every index request | page count passed into `_display_title`; warm index TTFB 60–84 ms, ~90 ms CPU | keep |
| Library-wide search fallback | 503 when no PageIndex cache/Elasticsearch | local page/line scan returns results | keep |

## React cutover web-vitals audit (2026-11-08)

Measured with headless Chromium at 1440×1000, loopback, against the 2-book fixture
(3-page PDF + Markdown), after the SPA cutover. Cold and warm are separate reloads.

| Metric | Cold | Warm | Rating |
| --- | --- | --- | --- |
| LCP | 476 ms | 360 ms | Good |
| FCP | 412 ms | 340 ms | Good |
| TTFB | 20 ms | 2 ms | Good |
| CLS | 0 | 0 | Good |
| INP | — | 16 ms (two UI interactions) | Good; small sample, not RUM |
| Long tasks | 0 | 0 | Good |

- Initial transfer: **131 KB gzip JS** (index 78 + UI 49 + library route 5), **8 KB gzip CSS**,
  **149 KB fonts**, and a **2.4 KB** LCP thumbnail. The shell HTML is 328 bytes gzip.
- `GET /api/library` took 7 ms; thumbnails and fonts were served from the local server with
  immutable/cache headers.
- LCP is the first tile thumbnail, not text or a layout element; CLS is 0.

**Verdict:** no optimization change was made. The measured user-facing metrics are already
in the Good band and the initial JS/CSS transfer is under the 200/50 KB budgets. There is no
Lighthouse/RUM budget gate for this localhost single-user app; the measurements above are the
recorded baseline for any future change.

Reverted/not kept: none of the measured changes were neutral; all were retained after re-measuring the transfer sizes or resource directories.
