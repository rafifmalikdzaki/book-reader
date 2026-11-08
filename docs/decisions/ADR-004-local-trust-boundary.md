# ADR-004: Local-only trust boundary and file-serving policy

## Status

Accepted

## Date

2026-11-08

## Context

The app is intentionally unauthenticated and binds to loopback by default. It
serves a user's private library, notes, chat sessions, and HTML rendered from
Markdown. Library content and model output are untrusted inputs even though the
operator is the only user.

Two file-serving paths cross a trust boundary: static precompressed assets and
`/raw/{rel}`. A path traversal in the gzip branch could expose files outside the
bundle, and a library `.html` or `.svg` served inline could execute on the app
origin and read every API route. Markdown HTML passthrough is already disabled,
but that alone does not protect raw file navigation.

## Decision

Treat localhost as the boundary, not as authorization.

- Bind to loopback by default and reject mismatched `Host` headers on loopback
  binds. A non-loopback bind skips that automatic allowlist; set an explicit
  policy when one is needed, and do not treat it as the supported deployment.
- Serve `/raw` inline only for PDF, Markdown, and common raster images. Use
  `application/octet-stream` plus `Content-Disposition: attachment` and
  `X-Content-Type-Options: nosniff` for every other library file, including HTML
  and SVG.
- Resolve precompressed static paths and require both the source and `.gz`
  candidate to remain inside the static root.
- Send a report-only CSP for SPA HTML documents; PDF.js keeps its own meta CSP.
  JSON, raw, thumbnails, and static assets do not receive the shell CSP.
- Keep session/project and notepad data local; no multi-tenant authorization is
  introduced.

## Alternatives Considered

### Add user accounts and full authorization

Rejected: the product is a single-user localhost reader; authentication would add
a second identity and session system without a threat boundary to separate.

### Enforce CSP immediately

Deferred: the current policy is report-only while the SPA and vendored PDF.js
are validated. Enforcement needs a violation review and `frame-ancestors` added;
it is not silently treated as complete.

### Serve every library file inline with guessed MIME types

Rejected: HTML/SVG on the app origin can execute scripts and access the local API.
Download semantics preserve access without turning library files into code.

## Consequences

- Direct requests to `/raw` for HTML/SVG download instead of rendering.
- Static gzip responses fail closed when a path or symlink escapes the root.
- Host checks must be configured for any intentional non-loopback binding, as
  Compose does for its published loopback port.
- The CSP remains report-only, so it detects issues but does not block them yet.
