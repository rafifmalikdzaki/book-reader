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

## 2026-11-09 baseline (redesign/ask-ui @ a17ef8a, docker `book-reader-local`)

Measured with Playwright/Chromium 1440×900 on loopback against the running container, plus curl and docker stats.

| Metric | Value | Budget | Verdict |
|---|---|---|---|
| Initial JS (`index-*.js`) | 526 KB raw / **162 KB gzip** | < 200 KB gzip | keep as-is |
| Lazy `ui-*.js` chunk | 270 KB raw / 90 KB gzip | off initial path | fine |
| `index-*.css` | 40 KB raw / 8.9 KB gzip | < 50 KB gzip | fine |
| TTFB `/` and `/ask` | 4–6 ms | — | fine |
| `/api/library` warm | 83–111 ms | < 200 ms p95 | fine |
| LCP `/` / `/ask` | 976 ms / 660 ms | ≤ 2.5 s | Good |
| Long tasks >50 ms | one 195 ms (hydrate) on `/`, one 147 ms on `/ask` | — | no pattern |
| Container idle | 0.12 % CPU, 207 MB RSS | — | fine |

System heat on the same machine at that time was **not** the app: a `pytest` run in `~/Research/kalbe/crd-dem-surrogate` (PID 946779) sat at ~97 % CPU and browser renderers (msedge 43 %, firefox RDD 33 %) held cores at 61–84 °C; the container stayed at 0.12 %. No app change made — per measure-first, nothing here justified one.

## 2026-11-10 baseline (main @ a1e03ea, docker `book-reader-local`, 186 books)

Same machine, 1440×900, loopback. "Cold" is the first request after the container was
recreated, so it pays the process's first scan and first PDF pass; "warm" is the repeat.

| Metric | Cold | Warm | Budget | Verdict |
|---|---|---|---|---|
| `GET /api/library` | 1.445 s | 0.097 s | < 200 ms p95 (warm) | fine |
| `GET /api/papers/keywords` | 2.278 s | 0.005 s | — | see below |
| `GET /api/zotero` | 0.391 s | 0.005 s | — | fine |
| Shell HTML `/`, `/ask` | — | 3–4 ms, 602 B gzip | — | fine |
| LCP `/` / `/ask` | — | 948 ms / 424 ms | ≤ 2.5 s | Good |
| CLS `/` | — | 0.03 | ≤ 0.1 | Good |
| FCP `/` | — | 712 ms | — | Good |
| Long task on `/` | — | one 129 ms | — | no pattern |

Build (production bundle from `just ci`): `index` 529.6 KB raw / **164.7 KB gzip** (budget
200 KB gzip), `ui` 270.7 / 91.2, `reader-pdf` route chunk 653.9 / 197.7, `AskPage` 28.6 / 9.9;
`index.css` 41.4 / 9.2. Vite warns that `index` and `reader-pdf` exceed 500 KB raw; initial
transfer stays inside the gzip budget.

`/api/papers/keywords` opens every PDF once per process to read its Info dictionary (13 of
186 books carry keywords or a DOI; the response is 1.5 KB). It runs in parallel with the
library list and is off the critical path: the list paints at ~1.45 s and bylines fill in at
~2.28 s. The zip is requested once per launch, not per navigation.

**Verdict:** no optimization change. The only idea with a measurable win — persisting this
cache into the state directory — would create a new state store that the project requires to
join the reindex transaction, backup list and shared lock, for a once-per-boot gain. Rejected.
Instead, the in-process cache (keyed by rel, size, mtime) now has a regression test
(`test_keywords_read_each_pdf_once_until_it_changes`) so a repeat request cannot silently go
back to opening 186 PDFs.

Deferred candidate, if cold start ever matters: `/api/library` already opens each PDF for
page counts and section titles in `api/views.py`; sharing that one pass with the metadata
read would take cold home from ~2.28 s to ~1.5 s, at the cost of a cross-domain change.

Two-page view verified live: toggle pressed, pages 2 and 3 render side by side, zoom refits
to 138 %, no console errors, reader stays on page 3.

## 2026-11-10 Ask retrieval: sections, page text, and result caches

Measured in-process against a copy of the live state (186 books, 10 cached PageIndex
trees), `library_wide(query, 12)`, no model calls. Cold = first query after `build_services`;
warm = the same process afterwards.

| Stage | Cold query | Repeat, same query | New query | 6 tool rounds |
|---|---:|---:|---:|---:|
| Baseline | 1,909 ms | 331 ms | 303 ms | 1,313 ms |
| + decoded section memo | 1,695 ms | 190 ms | 243 ms | 994 ms |
| + normalized page-text cache | — | 190 ms | 163 ms | — |
| + 64-entry query→hits LRU | 1,710 ms | **0.2 ms** | 163 ms | **0.7 ms** |

- `SectionIndex.sections()` decoded the whole tree on every `section_for_page` call: 588
  decodes per query, 62% of the warm profile. Decoded lists are now reused while the cache
  entry they came from is still the live object; extraction, remap and reload replace the
  entry, so stale trees decode again.
- `_page_texts` re-joined and re-split every page on every query. `PdfCache.page_text_normalized`
  caches the collapsed text with the same mtime-keyed, 4096-entry bound. New queries now
  extract only pages they have never seen (13 of 516 in the measurement).
- `PageIndexSearch` keeps 64 query→hits results, keyed by query, limit, book, and a
  signature of every book's `(rel, mtime, size)` plus the cached tree set. An edited file or
  a new tree misses; the 30 s library scan TTL is the staleness ceiling.
- Cold cost is unchanged (~1.7 s): that is the first extraction of 516 pages across 10 books,
  serialized under `PdfCache`'s lock. Parallel extraction would need one document per thread;
  not attempted.

Both caches are guarded by `test_pageindex_reuses_a_result_until_the_library_changes` and
`test_normalized_page_text_avoids_rewalking_the_page`.

## 2026-11-10 Ask prompt tokens: per-question steering

Prompt text plus tool schemas and descriptions, measured with `build_services` on the live
library; ≈tokens is characters / 4, consistent with the numbers above. Before, every request
carried the full OpenUI format guide (6,774 chars), the teacher block and all seven tools
(4,036 chars of schema + descriptions) whatever the question.

| Request | Before ≈tok | After ≈tok | Change |
|---|---:|---:|---|
| Plain question, no book ("Hello there.") | 3,461 | 1,380 | −60 % |
| Locator question ("What page defines…") | 3,461 (no book) | **946** | −73 % |
| Save-to-notes question | 3,461 | **806** | −77 % |
| Survey ("Which books should I read…") | 3,461 | 3,084 | −11 % |
| Explanation ("Explain consistent hashing") | ~3,200 (book context) | 2,653 | ~−17 % |
| Book page + 8k excerpt, locator | 5,141 | 3,021 | −41 % |
| Book page + 8k excerpt, explanation | 5,141 | 4,728 | −8 % |
| Socratic tutor | 5,530 | 5,001 | −10 % |

The saving is structural: non-visual questions skip the component guide, and every request
binds 3–6 tools instead of 7 (`add_note` only for note questions). Visual shapes still carry
the full guide, because a malformed `openui` block is worse than the tokens. Selection is
deterministic regex over the last user message (no model call, no added latency); the worst
case is the fallback that keeps all read-only tools and the plain-Markdown instruction.
