# ADR-009: Feature-first backend packages

Status: accepted

## Context

The React app is organized by feature, but the Python backend was a flat directory of
~30 modules. `app.py` held service construction and 17 inline routes, `search.py` (903
lines), `reconcile.py` and `organize.py` each combined several responsibilities, and
`library.py` and `chat_config.py` imported FastAPI only to raise HTTP errors. `chat/` and
`evals/` were already packages.

## Decision

Group the backend by feature and keep the HTTP layer as a thin adapter:

```text
state/    lock, remap, preferences          reading/  pdf, markdown, pages, progress, sections
library/  scan, models, errors              notes/    store
search/   types, text, elastic, pageindex, service
chat/     types, providers, config, sessions, registry (langchain-free)
          service, graph, tools, model, prompts, sources, context (langchain-backed)
organize/ categories, mistral, service      reindex/  manifest, reconciler, redirects
api/      errors, security, static, views, routes/*
services.py (composition root)   app.py (factory)
```

Rules:

1. **Import direction.** `api/` and `services.py` may import domain packages; domain
   packages never import `api/`, `services.py` or `app.py`. Stores never import `reindex/`;
   `reindex/` imports stores. `state/` is lowest.
2. **No HTTP in the domain.** Domain code raises `InvalidPath`, `PathNotFound`,
   `UnknownModel`; `api/errors.py` maps them to the existing 400/404 `{"detail": ...}`
   responses.
3. **Optional extras stay lazy.** `chat/__init__.py` is empty. Only `service`, `graph`,
   `tools`, `model`, `prompts`, `sources` and `context` import langchain; `types`,
   `providers`, `config`, `sessions` and `registry` must not.
4. **Explicit route registration.** Each module in `api/routes/` exposes
   `register(app, **deps)`; no DI container.
5. **No shims.** Old module paths were deleted in the same change as their callers.

Tests mirror the packages under `tests/<package>/`. HTTP paths, CLI flags, state-file
formats and payloads are unchanged; the OpenAPI path/method table was diffed before and
after each route move.

## Consequences

`app.py` is a ~150-line factory. A new route goes in `api/routes/`, a new store in its
feature package. `routes_chat_sessions` (now `api/routes/chat_sessions.py`, ~500 lines,
owning `SessionTaskHub`) is moved as-is; extracting the hub and runner is a follow-up.
ADRs 006 and 008 mention the old file names; they are left unchanged (append-only).
