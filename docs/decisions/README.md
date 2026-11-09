# Architecture decision records

| Record | Decision |
| --- | --- |
| [ADR-001](ADR-001-react-spa.md) | Serve a React SPA from FastAPI; the legacy Jinja UI is retired. |
| [ADR-002](ADR-002-vendored-reader-assets.md) | Keep PDF.js and KaTeX vendored and lazy behind a same-origin bridge (partially superseded by ADR-007). |
| [ADR-003](ADR-003-content-hash-reindex.md) | Key portable state by content hash and migrate through a transactional reindex. |
| [ADR-004](ADR-004-local-trust-boundary.md) | Treat localhost as the boundary; harden raw files, static paths, Host checks, and CSP. |
| [ADR-005](ADR-005-ask-surfaces-and-retention.md) | Keep a stateless reader rail and a persistent `/ask` workspace with 7-day retention. |
| [ADR-006](ADR-006-auto-build-frontend-on-startup.md) | Auto-build the React SPA bundle on startup in source checkouts and include core extras by default. |
| [ADR-007](ADR-007-react-pdf-viewer.md) | Render PDFs natively in React 19 via `react-pdf` v11 with windowed canvas virtualization and local CMap/font assets. |
| [ADR-008](ADR-008-openui-native.md) | Render chat blocks with the official OpenUI library (OpenUI Lang, generated and committed prompt, legacy JSON kept until chats expire). |

ADRs are append-only. If a decision changes, add a new record and mark the old
one as superseded or deprecated; do not rewrite history.
