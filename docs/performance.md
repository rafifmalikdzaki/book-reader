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

Browser lab: index LCP/FCP 140 ms, TTFB ~74 ms, CLS 0, no long tasks observed on the tile library. INP was not collected with a reliable trace; interactions were exercised manually. PDF.js first page and math rendering were verified in the browser; their paint times were not separately traced.

Reverted/not kept: none of the measured changes were neutral; all six were retained after re-measuring the transfer sizes or resource directories.
