# ADR-003: Content-hash identity and transactional reindex

## Status

Accepted

## Date

2026-11-08

## Context

Books live in a user-managed folder and are routinely renamed, moved between
folders, copied, or deleted. Reading positions, notes, page counts, section
trees, categories, and chat book/source references must survive those file
operations. A path-based key breaks on every rename; a database would add an
external service without removing the need to detect file changes.

## Decision

Give each book a SHA-256 content hash in `library_manifest.json`. Paths are
current locations, not identity. On startup, index view, and explicit reindex,
`LibraryReconciler.sync()` compares the library with the manifest and moves state
only when a missing path and an appeared path match one-to-one by content.

All state stores share one process `RLock` and the cross-process
`StateDirectoryLock`. A reindex first copies affected state files to
`state/backups/reindex-<timestamp>/`, writes `reindex_transaction.json`, remaps
`progress`, `notepad`, `pages`, `sections`, and `chats`; category assignments are
already keyed by content hash. It commits the manifest and move log, then clears
the marker. Any failure rolls the stores back; a crash restores the snapshot on
the next sync.

## Alternatives Considered

### Key state by relative path

Rejected: a rename or folder move would orphan notes, progress, and chat
references. The current redirect log cannot repair that after the fact.

### Require a database and import the library into it

Rejected: the app is deliberately local and file-first, and the book files are
the source of truth. The manifest already gives the join key for future tools
such as Zotero.

### Match moves by filename or timestamps

Rejected: copies and renames make those signals ambiguous; content matching is
the only reliable one-to-one identity.

## Consequences

- First indexing hashes file content; unchanged files reuse inode/size/mtime
  metadata from the manifest.
- A move that is also edited before reindex cannot be matched and remains in the
  backup rather than being guessed.
- Elasticsearch still stores paths at index time and must be rebuilt after a
  reorg.
- Every new persistent store must join the backup list, shared lock, and remap
  path; `chats.json` follows this rule for book/source references.
