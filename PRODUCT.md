# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: a researcher working on a single machine with their own library. No accounts, no
teammates, no shared tenancy. They read long technical documents (PDF papers, textbooks,
Markdown notes) on a laptop and occasionally on a phone browser, and they move between many
books in a week rather than finishing one at a time.

## Product Purpose

A local reading and research surface for a personal PDF/Markdown library. It exists so that
reading, annotating, resuming, and asking questions about a book all happen in one place,
without exporting excerpts into another tool. Success means a passage found today can be
found again — by page, section, or line — and becomes usable context later.

## Positioning

Three things together, which a generic PDF viewer or a chat-over-files tool cannot truthfully
claim:

1. **Section-aware retrieval.** PageIndex layout trees give search a document's section
   structure, not just page text, and hits carry section labels.
2. **Locator notes.** Selecting text yields a note anchored to book + page + word/character
   span and section (PDF) or line range + paragraph + section (Markdown), exportable as
   structured context.
3. **Grounded chat.** The agent searches and reads the library through tools, and answers cite
   the exact page, line, or section it used.

## Operating Context

- The library is a folder of roughly 200 PDFs plus Markdown files, nested by topic, read in
  place; files are never imported into a database.
- Reading sessions are interrupted and resumed; page and scroll position persist per book.
- Annotations are made while reading, often mid-passage, then grouped by idea rather than by
  book, and exported as Markdown or JSON.
- Questions are asked about the current book or across the library; answers are expected to
  point back into the source.
- Runs locally (`uv run book-reader`) or containerized with Docker Compose; the container binds
  to `127.0.0.1` because there is no authentication.
- Optional services: Elasticsearch for full-text chunks, PageIndex Flash for section trees,
  and LLM providers for chat (Mistral, Inception, OpenRouter, Ollama).

## Capabilities and Constraints

Confirmed capabilities: library browsing and filtering; PDF page rendering with a selectable
text layer; Markdown rendering with tables and code highlighting; in-book and library-wide
search; table of contents; keyboard paging and deep links (`#pN`, `#L<n>`); reading progress;
notepad groups, notes, and export; model selection with a provider fallback chain.

Constraints:

- Single-user, localhost-only; there is deliberately no auth or multi-tenancy.
- State lives in plain JSON files under a state directory and is written atomically; exports
  must stay readable without the app.
- Cloud chat requires user-supplied API keys; every feature must still work with local
  search, local notes, and Ollama.
- PageIndex extraction is offline but costs seconds per book on first access; section trees
  and page counts are cached by file mtime and size.
- Elasticsearch is optional; search degrades to PageIndex tree search, then to page-text scan.

Explicitly undecided: accessibility standard (no target such as WCAG AA has been established);
multi-user support; any hosted or sync story.

## Brand Commitments

Name: **book-reader**. No binding voice, typography, palette, or visual constraint has been
declared beyond the product's local-first, no-account character.

## Evidence on Hand

- A real personal library at `~/Documents/Books` (about 200 entries, nested), used as the
  working dataset.
- Benchmark harness `scripts/benchmark_rag.py` with ten golden questions over a 36-page paper;
  recorded results: PageIndex hybrid hit@1 1.00 / MRR 0.95 / ~8 ms, Elasticsearch 0.90 / 0.78 /
  ~24 ms, local page scan 0.20 / 0.20 / ~190 ms.
- Test suite of 52 tests plus ruff and mypy strict gates; CI green.
- Frontend critique and browser screenshots from the running app.

Absent and must not be fabricated: external customers, testimonials, usage analytics,
publication or citation counts.

## Product Principles

1. **The passage is the unit.** Every note, hit, and answer resolves to a book plus page,
   section, or line; unlocated evidence is not acceptable output.
2. **Reading first, chrome second.** The page or text is the largest, most legible thing on
   screen; controls stay quiet and never displace the document.
3. **Local by default.** Localhost, no accounts, plain files; cloud models only through
   user-supplied keys, and every feature keeps a local path.
4. **The user's state is portable.** Notes, progress, and exports remain readable JSON/Markdown
   without the app.
5. **Fail honestly.** A failure must look different from an empty result, and a lost action
   must be recoverable.
