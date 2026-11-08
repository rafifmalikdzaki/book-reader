# ADR-001: Serve a React SPA from FastAPI

## Status

Accepted

## Date

2026-11-08

## Context

The application is a single-user, localhost-only reading tool with no SEO,
multi-tenant, or server-rendering requirement. The previous frontend was six
Jinja templates with inline CSS and JavaScript plus six globally coupled IIFE
scripts. That made DOM-ID coupling and CSP enforcement difficult, and kept
browser state outside the component tree.

The backend remains Python/FastAPI because it owns the library cache, PyMuPDF,
search, content-hash reindexing, state locks, chat, and notepad data. The
frontend needs a component model, typed API calls, and a testable build without
adding a second application server.

## Decision

Build the UI as a React 19 + TypeScript single-page application in `frontend/`
with Vite and React Router. FastAPI serves the generated
`src/book_reader/static/app/` bundle for `/`, `/ask`, `/design`, and
`/book/{rel}`. The SPA is the only UI; Jinja templates and legacy scripts are
deleted.

Use CSS Modules and the existing reading-room CSS tokens, TanStack Query for
server state, and React context for panel, notepad, and book context. Route
chunks lazy-load the library, Ask, Markdown, PDF, and development-only design
pages.

The source checkout requires `scripts/build_frontend.sh`; the wheel and Docker
image include the generated bundle. A missing bundle returns a 503 with the build
command. Moved-book 307 redirects remain authoritative in FastAPI and run before
the shell.

## Alternatives Considered

### Keep Jinja and incrementally mount React islands

Rejected: the requested cutover was a full SPA, and the existing pages share
global DOM state and custom events. A hybrid would preserve the coupling and
require two build/runtime models.

### Next.js or another SSR framework

Rejected: there is no SEO or public web surface, and the data and state lock live
in a local FastAPI process. SSR would add a second server, routing model, and
deployment path without a user-facing benefit.

### Micro-frontends or one mount per page

Rejected: a single user and a small route surface do not justify independent
deployments or duplicated shell state.

## Consequences

- The project needs Node 22/npm and a build step before a source checkout can
  serve HTML.
- Frontend behavior is covered with Vitest and Testing Library; Python tests use
  a stub SPA shell where HTML is not the subject.
- FastAPI still owns path validation, content-hash reindexing, redirects, and
  all state mutations.
- The report-only CSP applies to shell documents; JSON, raw files, and static
  assets have separate policies.
- There is no legacy fallback at runtime. A bundle is a packaging prerequisite,
  not an optional mode.
