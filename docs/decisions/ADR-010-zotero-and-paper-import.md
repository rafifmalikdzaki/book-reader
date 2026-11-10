# ADR-010: Local Zotero metadata and guarded paper import

Status: accepted

## Context

The library is a folder of PDFs with little bibliographic data: titles come from file
names, and there are no authors, years or topics to group by. Many of the same files are
also filed in Zotero, and new papers arrive as a DOI or an arXiv id rather than as a file.
Until now the app never made an outbound request except to the configured model
providers, and never added a file to the library (ADR-004).

## Decision

1. **Zotero is a read-only local source.** `zotero/library.py` opens `zotero.sqlite` with
   `mode=ro&immutable=1` and matches attachments to books by content md5 (only for files
   whose size equals an attachment's), then file name, then arXiv id/DOI, then normalized
   title. The result is served by `GET /api/zotero` and cached by database mtime/size. No
   Web API, no key, no sync, no writes, and nothing copied into the state dir.
2. **One guarded fetcher.** `papers/fetch.py` is the only module that downloads on the
   user's behalf, and only in response to `POST /api/papers/import`. It resolves arXiv ids
   through the arXiv API and DOIs through Crossref (plus Unpaywall when
   `BOOK_READER_UNPAYWALL_EMAIL` is set), accepts https only, refuses non-public addresses,
   re-validates every redirect, caps the body at 150 MB and requires the `%PDF-` magic.
   A paper with no open-access PDF is a 422 with a plain explanation; there is no scraping
   and no paywall workaround.
3. **Metadata travels in the file.** Title, authors, keywords and DOI are written into the
   PDF Info dictionary before the file is linked into `<library>/Papers/` (temp file plus
   `os.link`, so an existing name is never overwritten). `GET /api/papers/keywords` reads
   them back. No new state store, so nothing to remap on reindex.
4. **Grouping is a view.** The SPA merges Zotero tags and embedded keywords and can group
   the library by tag or Zotero collection. Categories and their store are unchanged.

## Consequences

- The "nothing leaves the machine" statement gains one explicit, user-initiated
  exception; README and AGENTS.md say so.
- Zotero coverage depends on the user's own filing; unmatched books simply carry no
  extra metadata. Embedded keywords are publisher-supplied and sometimes noise, so links
  and bare numbers are dropped.
- The library folder must be writable for import; a read-only mount turns import into an
  error message and leaves everything else working.
- A containerized deployment needs the Zotero directory mounted and passed with
  `--zotero-dir` to get Zotero metadata.
