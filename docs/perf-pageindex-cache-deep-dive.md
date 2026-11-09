# Why Ask pegged a CPU core, and the one-line cache fix

Untracked working note (2026-11-09) — not part of the ADR series yet.
Measured on the real library (224 books, 10 cached PageIndex trees, ~3.4 GB PDFs),
in-process with no browser open and no model calls.

## 1. The symptom

Fans up / ~70 °C whenever the app felt busy, worst around Ask. The server measured
idle at 0 % CPU when nobody was using it, so the heat had to come from *work* —
short bursts, not a background loop.

## 2. Measuring first (the part that found the bug)

The guess list (browser rendering, ngrok, Ask polling, startup reindex) was all
cheap-to-moderate. Before touching code, one profile answered where CPU actually
goes: build the services against a **copy of the real state**, wrap
`PdfCache.page_text` with a counting shim, and run `cProfile` over real
`library_wide()` queries.

| Scenario | Wall | CPU | Pages extracted |
|---|---|---|---|
| One `search_library` call (cold) | 2,206 ms | 2,194 ms | 992 |
| Same query again | 2,137 ms | 2,125 ms | 992 — **all re-extracted** |
| 6 Ask-style tool rounds | ~10.7 s | ~10.6 s | 4,528 |
| cProfile attribution | — | — | 92 % in `pymupdf` `page_get_textpage` |

The headline number: across 8,496 extractions the text cache produced **0 hits**.
A cache with a 0 % hit rate isn't a cache — it's overhead.

## 3. Root cause: an LRU that cannot match its access pattern

`PageIndexSearch` looks for evidence by brute force:

- for every cached book (up to 10), pick up to `MAX_SCAN_PAGES = 240` candidate
  pages (`pageindex.py`);
- for each page in **ascending order**, call `pdf.page_text(path, page)`
  (`reading/pdf.py`) and score term frequencies.

`PdfCache` kept the extracted page texts in an LRU capped at **64 entries**,
keyed `(path, mtime, page)`.

Walk the access pattern against that cap:

1. Page 1 is extracted and cached (cache: 1 entry). Page 2: never cached yet →
   miss. Same for 3…240. A strictly ascending first-touch sequence gets **zero
   reuse within one scan** — you always read page *n+1*, never page *n−k*.
2. At the end of the scan the cache holds pages 177–240 of that book.
3. The next query starts a different book (or restarts book 1 at page 1). Page 1
   is a miss, its insert evicts page 177, and so on. The carry-over from step 2
   is evicted before it is ever read again.
4. Net across queries: every query re-parses ~1,000 pages from scratch, ~2 ms
   per page, single-threaded (PyMuPDF calls are serialized under `PdfCache`'s
   lock).

The amplifier is the chat agent: one Ask question runs up to
`MAX_TOOL_ROUNDS = 6` tool calls, so one answer did ~6 × full re-extraction —
~10.6 s of one core pegged. That's the heat, and it happened on *your* machine
even though the CPU chart showed nothing while idle.

**The lesson: a cache's hit rate is a property of the *access pattern*, not of
the data.** 64 entries was plenty for the interactive viewer (one page at a
time) and useless for bulk scan (sequential first-touch). Same cache, same data,
two consumers, opposite outcomes.

## 4. Why the other suspects were exonerated

- `/api/library`: confirmed cheap. The 30 s scan TTL really exists
  (`SCAN_TTL_SECONDS = 30.0` in `library/scan.py`); first call 1.4 s cold,
  then ~75–115 ms, idle 0 %.
- Startup import: real but one-time — importing `chat.service` through
  `build_services` costs **~1.2 s CPU at every launch** because LangChain/
  LangGraph import eagerly. Worth a lazy-import follow-up someday; irrelevant
  to sustained heat.
- ngrok / your friends: negligible compute risk on a 190 MB process.

## 5. The fix (measured, minimal)

Cache keys and staleness were already right (`(path, mtime, page)` — an edited
file drops out on its own). Only the size was wrong. One line in
`src/book_reader/reading/pdf.py`:

```python
# PageIndex scans read ~240 pages per book in ascending order, which
# never revisits entries, so this cache only pays off across queries
# when it holds several whole scans at once. Keyed by mtime, so an
# edited file drops out on its own.
self._text_max = 4096
```

4096 ≈ 10+ cached trees × 240 pages + headroom, so a full multi-book scan round
fits and survives into the next query. Worst-case memory: ~10–20 MB of page
text (dense pages run 2–5 KB). An alternative — a per-book text cache inside
`PageIndexSearch` — would have added ~30 lines, its own eviction and locking
for the same win; rejected as needless duplication.

Same harness, same conditions (one variable changed, so the delta is
attributable):

| Scenario | Before | After | |
|---|---|---|---|
| Cold query (one-time cost, must stay) | 2,194 ms CPU | 2,216 ms CPU | unchanged ✓ |
| Repeat query | 2,125 ms | **122 ms** | 17× |
| 6 Ask tool rounds | 10,614 ms | **636 ms** | 16.7× |
| Cache totals | 8,496 extracts / 0 hits | 1,014 extracts / 7,482 hits | |
| RSS during the run | 175 → 269 MB climbing | flat at 235 MB | |

## 6. The test that bit back

The regression test (`test_repeat_query_does_not_reextract_page_text` in
`tests/search/test_retrieval.py`) first asserted 4 extractions and failed with
**8**. The shim wrapped `page_text` and counted *invocations* — but an
invocation still happens on a cache hit; only the PyMuPDF parse is skipped.
Counting at the wrong layer "proved" the cache was broken when it was working.

Correct instrumentation counts **misses at the cache boundary** (is the key
absent from the cache before the call?), not calls at the function boundary.
The fixed test passes, and would catch a future re-shrink of the LRU.

## 7. What is still true after the fix

- The first library-wide query after startup still costs ~2.2 s CPU once
  (extraction has to happen somewhere).
- Cold books with no section tree still build one on first open/search.
- Startup still pays ~1.2 s for the eager chat-stack import.
- Browser-side PDF rendering was never the server; a busy tab will still warm
  a laptop.

## 8. Takeaways

1. Profile before optimizing — every guess on the list was plausible, only one
   was real, and the profile named it in one run.
2. A cache is only as good as its fit to the access pattern; hit rate is the
   receipt, so instrument it.
3. Watch for amplification loops: cost × rounds (tool calls) is how a
   "2-second search" becomes a pegged core.
4. Instrument at the layer whose behavior you're testing (cache misses, not
   function calls), or the test lies to you.
