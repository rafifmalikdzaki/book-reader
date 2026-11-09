# Implementation Plan: Feature-first backend restructure

## Overview

The React application is organized by feature, but the Python backend is still a flat
directory of ~30 modules (plus the already-split `chat/` and `evals/` packages). HTTP
adapters, domain services, JSON persistence, and infrastructure concerns are mixed
together: `app.py` is 641 lines and owns both application construction and 17 inline
routes; `search.py` (903 lines), `reconcile.py` (685), and `organize.py` (556) combine
several responsibilities; `routes_chat_sessions.py` (499) and `routes_library.py` (490)
sit beside the domain modules; `library.py` and `chat_config.py` import FastAPI solely
to raise HTTP errors.

**Revision note (HEAD `3bffff1`).** This plan was first written at `7b16aa1`. Since
then `chat.py` was split into the `chat/` package and `evals.py` into `evals/`, and the
model registry (`models.py`, `models.json`), `chat_types.py`, and `chat_providers.py`
were added. The chat tasks below are rewritten for that state; the rest is unchanged.

This plan turns the backend into a feature-first modular monolith. The HTTP and
CLI contracts, the React frontend, the vendored assets, and all user-visible
behavior stay unchanged. The result should read like the frontend: one package
per feature, an explicit API boundary, and small composition code.

## Target structure

```text
src/book_reader/
  __init__.py
  __main__.py                 CLI argument parsing and process startup
  app.py                      FastAPI factory, lifespan, middleware, mounts, route registration
  services.py                 Services dataclass, build_services, environment defaults
  api/
    __init__.py
    errors.py                 HTTP exception handlers and domain-error mapping
    security.py               Host allowlist + CSP middleware
    views.py                  Library/book response shaping shared by routes
    routes/
      __init__.py
      library.py              /api/library, /api/book, /thumb.jpg, /raw
      reading.py              /api/progress, /api/pages
      search.py               /api/search, /api/index/status, /api/index/rebuild
      organize.py             /api/organize, /api/organize/status
      chat.py                 /api/chat, /api/chat/status, /api/chat/options
      chat_sessions.py        /api/chat/sessions, /api/chat/projects
      notepad.py              /api/notepad
      spa.py                  /, /ask, /design, /book/{rel}
      system.py               /healthz, /api/library/reindex
  library/
    __init__.py
    errors.py                 Domain path errors; no FastAPI imports
    models.py                 Book, UNFILED
    scan.py                   Library: scanning, safe path resolution
  reading/
    __init__.py
    pdf.py                    PdfCache
    markdown.py               Markdown rendering and line search
    pages.py                  Persisted page counts
    progress.py               Reading positions
    sections.py               PageIndex section trees
  search/
    __init__.py
    types.py                  SearchHit, SearchUnavailable
    elastic.py                ElasticSearch, RebuildJob
    pageindex.py              PageIndexSearch
    service.py                Searcher and local retrieval
    text.py                   Shared query-term, snippet and chunk helpers
  notes/
    __init__.py
    store.py                  NotepadStore, groups, notes, export
  chat/
    __init__.py               Empty on purpose: keeps optional imports lazy
    types.py                  ChatMessage, AskOptions/AskCallbacks, ChatBackend, errors (no langchain)
    providers.py              resolve_providers, PROVIDER_DEFAULTS, DEFAULT_PRIORITY (no langchain)
    config.py                 Request limits, model selection (no FastAPI, no langchain)
    sessions.py               ChatStore, sessions, projects, retention (no langchain)
    registry.py               Model registry loader (models.json beside it; no langchain)
    service.py                ChatService (provider fallback chain)   [exists]
    graph.py                  LangGraph agent loop                    [exists]
    tools.py                  Agent tools and found-document reporting [exists]
    context.py, prompts.py, sources.py, model.py, state.py, limits.py   [exist, unchanged]
  organize/
    __init__.py
    categories.py             CategoryStore, category records
    mistral.py                MistralClient, taxonomy parsing
    service.py                LibraryOrganizer background job
  reindex/
    __init__.py
    manifest.py               FileStamp, hashing, manifest comparison
    reconciler.py             LibraryReconciler, ReindexReport, move log
    redirects.py              moved_book_target()
  state/
    __init__.py
    lock.py                   StateDirectoryLock
    preferences.py            Preferences store
    remap.py                  statemove/remap primitives
  evals/                      already a package; stays top-level, excluded from the wheel
  prompts/, skills/, static/  data directories, unchanged
```

`frontend/`, `static/vendor/`, `static/app/`, HTTP paths, CLI flags, state file
formats, and response payloads are out of scope for this restructure.

## Task sizing note

Move tasks touch more than five files only through mechanical import updates;
each has one ownership boundary and no behavior change. No task combines two
independent features.

## Architecture decisions

1. **Feature-first modular monolith.** Domain packages own their service,
   persistence types, and orchestration. The API package is an adapter; it does
   not contain business logic.
2. **One composition root.** `services.py` builds stores and services; `app.py`
   owns process lifetime, middleware, mounts, and registration. Neither domain
   package imports `app.py` or `services.py`.
3. **Low-level state stays low-level.** `state/remap.py` is imported by reading
   and note stores. `reindex/` is the cross-cutting orchestrator that imports
   those stores. Stores never import `reindex/`, avoiding cycles.
4. **No HTTP types in domain code.** `library/scan.py` and `chat/config.py` raise
   domain errors; `api/errors.py` maps them to the existing 400/404 responses.
5. **Explicit route registration.** Keep `def register(app, **deps)` in each
   route module rather than introducing a DI container or a global service
   locator. This preserves test seams and makes dependencies visible.
6. **Clean cutover, no shims.** Old modules are deleted and all imports, tests,
   scripts, and docs are updated in the same task. No re-export compatibility
   modules remain. This includes the re-exports in today's `chat/__init__.py`:
   callers import from `chat.service`, `chat.sources`, `chat.types`, etc.
7. **No behavior change.** Move and split first; do not rename endpoints, alter
   state keys, change error text, or add validation.
8. **Lazy optional imports.** `chat/__init__.py` must be empty. Only `chat/service.py`,
   `graph.py`, `tools.py`, `model.py`, `prompts.py`, `sources.py`, and `context.py`
   import LangChain/LangGraph; `types`, `providers`, `config`, `sessions`, and
   `registry` must stay langchain-free because routes import them eagerly. Import
   the langchain-backed modules only inside `build_services()` and request handlers.

## Task List

### Phase 0: Baseline

- [ ] Record baseline: `./scripts/ci.sh` at `3bffff1` (224 Python, 249 frontend).
- [ ] Capture current module/import map (`rg '^from \.|^import \.' src/book_reader`).

### Phase 1: Foundations

- [ ] Task 1: Create `state/` and move lock, remap, preferences.
- [ ] Task 2: Create `library/` and split scan/models.
- [ ] Task 3: Create `reading/` and move reader modules.
- [ ] Task 4: Create `notes/` and move the notepad store.

### Checkpoint: Foundations

- [ ] No old state/library/reading/notes module paths remain.
- [ ] `uv run pytest -q` and import smoke pass.

### Phase 2: Large domains

- [ ] Task 5: Split `search.py` into `search/`.
- [ ] Task 6: Fold the flat chat modules into `chat/` and empty its `__init__`.
- [ ] Task 7: Split `organize.py` into `organize/`.
- [ ] Task 8: Move reindex into `reindex/` with manifest/reconciler split.

### Checkpoint: Domains

- [ ] No old search/chat/organize/reconcile module paths remain.
- [ ] Domain import graph is acyclic; optional chat imports stay lazy.
- [ ] Focused domain tests pass.

### Phase 3: API boundary and composition root

- [ ] Task 9: Extract `api/security.py`, `api/errors.py`; decouple domain errors.
- [ ] Task 10: Extract library/reading/search routes and shared views.
- [ ] Task 11: Extract organize/chat/system routes; move existing route modules.
- [ ] Task 12: Slim `app.py`; move `Services` and `build_services` to `services.py`.

### Checkpoint: API

- [ ] No route bodies or service construction remain in `app.py`.
- [ ] HTTP status codes, payloads, and headers are unchanged.
- [ ] SPA shell and API tests pass.

### Phase 4: Tests and documentation

- [ ] Task 13: Mirror tests under `tests/<package>/`; update mypy/CI paths.
- [ ] Task 14: Update docs, ADR-009, changelog; final full gate, packaging check, browser smoke.

### Checkpoint: Complete

- [ ] All acceptance criteria met.
- [ ] `./scripts/ci.sh` green.
- [ ] Wheel/Docker contracts unchanged.
- [ ] No old paths, HTTP-in-domain imports, or shim modules remain.

## Task details

### Task 1: Create `state/` and move lock, remap, preferences

**Type:** `implementation`

**Description:** Create the low-level state package and move the three modules
that other features depend on: `state_lock.py`, `statemove.py`, and
`preferences.py`. Update imports mechanically. No behavior change.

**Acceptance criteria:**
- [ ] `state/lock.py`, `state/remap.py`, and `state/preferences.py` own the code.
- [ ] `rg 'book_reader.state_lock|book_reader.statemove|book_reader.preferences'` returns nothing.
- [ ] Tests that monkeypatch `book_reader.chats.time` are not affected yet.

**Verification:**
- [ ] `uv run pytest -q tests/test_state_lock.py tests/test_chats.py tests/test_reindex.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.state.lock import StateDirectoryLock; from book_reader.state.remap import plan_remap; from book_reader.state.preferences import Preferences"`

**Dependencies:** None

**Files likely touched:** three moved modules, `app.py`, `__main__.py`, tests and
import-only call sites.

**Estimated scope:** Medium (3 owned files; mechanical import updates).

### Task 2: Create `library/` and split scan/models

**Type:** `implementation`

**Description:** Move `library.py` into `library/scan.py`, extract `Book` and
`UNFILED` into `library/models.py`, and add an empty package `__init__`. Keep the
current `HTTPException` behavior until Task 9; this task only changes ownership.

**Acceptance criteria:**
- [ ] `Library`, `Book`, and `UNFILED` import from their new modules.
- [ ] `library/scan.py` still resolves paths through the same checks and status codes.
- [ ] No `book_reader.library` import remains outside the package.

**Verification:**
- [ ] `uv run pytest -q tests/test_reader.py tests/test_library_api.py tests/test_host_and_hidden.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.library.scan import Library; from book_reader.library.models import Book, UNFILED"`

**Dependencies:** Task 1

**Files likely touched:** `library.py`, new `library/*.py`, `app.py`, route
modules, scripts, tests.

**Estimated scope:** Medium (4 owned files; mechanical import updates).

### Task 3: Create `reading/` and move reader modules

**Type:** `implementation`

**Description:** Move `pdf.py`, `mdrender.py`, `pages.py`, `progress.py`, and
`sections.py` under `reading/`, renaming `mdrender.py` to `markdown.py` and
`pages.py` remains `pages.py`. Update all imports, including `search`, `chat`,
reindex, routes, and benchmarks.

**Acceptance criteria:**
- [ ] All five modules import from `book_reader.reading.*`.
- [ ] `mdrender.py` no longer exists.
- [ ] PDF and Markdown API tests pass unchanged.

**Verification:**
- [ ] `uv run pytest -q tests/test_reader.py tests/test_retrieval.py tests/test_reindex.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python scripts/benchmark_rag.py --help`

**Dependencies:** Tasks 1-2

**Files likely touched:** five moved modules, search/chat/reindex/routes, tests,
benchmark.

**Estimated scope:** Large (5 owned files; import churn only).

### Task 4: Create `notes/` and move the notepad store

**Type:** `implementation`

**Description:** Move `notepad.py` to `notes/store.py`. Keep the notepad HTTP
module in place until Phase 3, but update its imports and chat tool imports.

**Acceptance criteria:**
- [ ] `NotepadStore`, `NotepadError`, and note limits import from `notes/store.py`.
- [ ] Note creation, patching, deletion, and export tests pass.
- [ ] No `book_reader.notepad` import remains.

**Verification:**
- [ ] `uv run pytest -q tests/test_reader.py tests/test_chat.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.notes.store import NotepadStore"`

**Dependencies:** Tasks 1-3

**Files likely touched:** `notepad.py`, new `notes/store.py`, route/chat/app imports,
tests.

**Estimated scope:** Small (2 owned files; import updates).

### Task 5: Split `search.py` into `search/`

**Type:** `implementation`

**Description:** Replace the 903-line `search.py` with four focused modules:
`types.py` (`SearchHit`, `SearchUnavailable`), `elastic.py` (`ElasticSearch`,
`RebuildJob` and Elasticsearch helpers), `pageindex.py` (`PageIndexSearch`), and
`service.py` (`Searcher` and the local scan), and `text.py` (query-term, snippet and chunk
helpers shared by all backends; added so the backends never import each other). No retrieval behavior
changes.

**Acceptance criteria:**
- [ ] `search/__init__.py` does not eagerly import optional backends.
- [ ] `Searcher` still selects `elastic`, `pageindex`, or `local` identically.
- [ ] Benchmark and retrieval tests import only from the new modules.
- [ ] `rg 'book_reader.search import'` returns nothing.

**Verification:**
- [ ] `uv run pytest -q tests/test_reader.py tests/test_retrieval.py tests/test_chat.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python scripts/benchmark_rag.py --help`

**Dependencies:** Tasks 1-4

**Files likely touched:** `search.py`, new `search/*.py`, chat/reindex/routes, tests,
benchmark.

**Estimated scope:** Medium (4 owned files; one module deletion; import updates).

### Task 6: Fold the flat chat modules into `chat/` and empty its `__init__`

**Type:** `implementation`

**Description:** `chat/` already holds the langchain-backed pieces (`service`, `graph`,
`tools`, `context`, `prompts`, `sources`, `model`, `state`, `limits`). Move the flat
chat modules in beside them: `chat_types.py` -> `chat/types.py`, `chat_providers.py`
-> `chat/providers.py`, `chat_config.py` -> `chat/config.py`, `chats.py` ->
`chat/sessions.py`, and `models.py` + `models.json` -> `chat/registry.py` +
`chat/models.json` (named `registry` so it does not clash with `chat/model.py`).
Then empty `chat/__init__.py` and point every caller at the submodule that owns the
name. The five moved modules must stay langchain-free. Keep `chat/model.py` where it
is so patches of `book_reader.chat.model.ChatOpenAI` stay valid. No behavior change.

**Acceptance criteria:**
- [ ] `chat/__init__.py` contains only a docstring; no re-exports remain.
- [ ] `rg 'book_reader\.(chat_types|chat_providers|chat_config|chats|models)\b|from \.(chat_types|chat_providers|chat_config|chats|models) '` returns nothing.
- [ ] `import book_reader.app` succeeds with langchain/langgraph blocked.
- [ ] `chat/models.json` is still found by the registry and shipped in the wheel.
- [ ] Retention tests that monkeypatch `book_reader.chats.time` target `book_reader.chat.sessions.time`.

**Verification:**
- [ ] `uv run pytest -q tests/test_chat.py tests/test_chat_sessions.py tests/test_chats.py tests/test_models.py tests/test_ask_evals.py tests/test_openui_contract.py`
- [ ] `uv run ruff check src tests scripts && uv run mypy src tests`
- [ ] `uv run python -c "import sys; sys.modules['langchain_core']=None; sys.modules['langgraph']=None; import book_reader.app; from book_reader.chat.types import AskOptions; from book_reader.chat.sessions import ChatStore; from book_reader.chat.config import select_model; from book_reader.chat.registry import model_info"`
- [ ] `uv run python scripts/eval_ask.py --help`

**Dependencies:** Tasks 1-5 (sessions import `state/remap`; tools import `notes`, `reading`, `search`)

**Files likely touched:** five moved modules + `models.json`, `chat/__init__.py`, `app.py`,
`routes_chat_sessions.py`, `reconcile.py`, `evals/*`, `scripts/eval_ask.py`, four test modules.

**Estimated scope:** Large (5 owned modules; import churn only).

### Task 7: Split `organize.py` into `organize/`

**Type:** `implementation`

**Description:** Move the category store and taxonomy types to
`organize/categories.py`, the HTTP/taxonomy client to `organize/mistral.py`, and
the background job to `organize/service.py`. Preserve the virtual category
contract and all JSON shapes.

**Acceptance criteria:**
- [ ] `CategoryStore`, `MistralClient`, and `LibraryOrganizer` import from their new modules.
- [ ] Categories remain keyed by content hash and files never move.
- [ ] Organizer success, failure, and unavailable-provider tests pass.

**Verification:**
- [ ] `uv run pytest -q tests/test_organize.py tests/test_chat_sessions.py tests/test_reindex.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.organize.categories import CategoryStore; from book_reader.organize.service import LibraryOrganizer"`

**Dependencies:** Tasks 1-4

**Files likely touched:** `organize.py`, new `organize/*.py`, app/routes/reindex,
tests.

**Estimated scope:** Medium (3 owned files; one module deletion; import updates).

### Task 8: Move reindex into `reindex/`

**Type:** `implementation`

**Description:** Move manifest/hash/move primitives to `reindex/manifest.py`, the
transactional reconciler to `reindex/reconciler.py`, and `moved_book_target` to
`reindex/redirects.py`. Keep `state/remap.py` low-level. Verify no import cycle
between stores and the reconciler.

**Acceptance criteria:**
- [ ] `LibraryReconciler`, `ReindexReport`, and `FileStamp` import from the new package.
- [ ] Reindex still backs up stores, writes/clears the marker, remaps, and reports moves.
- [ ] No store imports `reindex`; `reindex` may import stores.
- [ ] `moved_book_target` is no longer imported from a route module.

**Verification:**
- [ ] `uv run pytest -q tests/test_reindex.py tests/test_reader.py tests/test_library_api.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "import book_reader.reindex.reconciler; import book_reader.reading.progress; import book_reader.chat.sessions"`

**Dependencies:** Tasks 1-7

**Files likely touched:** `reconcile.py`, new `reindex/*.py`, app/routes/services,
tests.

**Estimated scope:** Large (3 owned files; one module deletion; import updates).

## Checkpoint: Domains

- [ ] Full Python suite passes.
- [ ] `rg 'book_reader\.(library|pdf|mdrender|pages|progress|sections|notepad|search|chats|chat_config|chat_types|chat_providers|models|organize|reconcile|state_lock|statemove|preferences)\b' src tests scripts` is empty, and `rg 'from book_reader.chat import|from \.chat import'` is empty.
- [ ] Optional chat import remains lazy.
- [ ] No behavior or state-file changes in the diff.

### Task 9: Extract `api/security.py`, `api/errors.py`; decouple domain errors

**Type:** `implementation`

**Description:** Move `security_headers.py` to `api/security.py`. Add
`library/errors.py` with invalid-path/not-found exceptions and replace the
FastAPI exceptions raised by `library/scan.py`. Replace the model-selection
HTTP exception in `chat/config.py` with a domain error. Map all three to the
existing HTTP status codes in `api/errors.py`; retain the JSON
`{"detail": ...}` handler.

**Acceptance criteria:**
- [ ] `rg 'from fastapi' src/book_reader/library src/book_reader/chat/config.py` is empty.
- [ ] Invalid paths still return 400; hidden/missing paths return 404; unknown models return 400.
- [ ] CSP and Host tests still pass.

**Verification:**
- [ ] `uv run pytest -q tests/test_host_and_hidden.py tests/test_library_api.py tests/test_reader.py tests/test_chat_sessions.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "import book_reader.library.scan; import book_reader.chat.config"`

**Dependencies:** Tasks 2, 6, 8

**Files likely touched:** `security_headers.py`, new `api/security.py`,
`api/errors.py`, `library/errors.py`, `library/scan.py`, `chat/config.py`, app,
tests.

**Estimated scope:** Medium (6 owned files; behavior-preserving error mapping).

### Task 10: Extract library/reading/search routes and shared views

**Type:** `implementation`

**Description:** Replace `routes_library.py` with `api/views.py` plus
`api/routes/library.py`, `api/routes/reading.py`, and `api/routes/search.py`.
Move `/thumb.jpg`, `/raw`, `/api/search`, `/api/progress`, `/api/pages`,
`/api/index/status`, and `/api/index/rebuild` out of `app.py`. Keep every route
path and payload identical.

**Acceptance criteria:**
- [ ] `app.py` no longer defines these route bodies.
- [ ] `LibraryViews` and moved-book redirect helpers live under `api/`/`reindex/`.
- [ ] Library, reader, SPA, and search API tests pass unchanged.

**Verification:**
- [ ] `uv run pytest -q tests/test_library_api.py tests/test_reader.py tests/test_spa_shell.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.api.routes.library import register; from book_reader.api.routes.search import register"`

**Dependencies:** Tasks 8-9

**Files likely touched:** `routes_library.py`, new `api/views.py`, three route
modules, app, tests.

**Estimated scope:** Large (5 owned files; route moves only).

### Task 11: Extract organize/chat/system routes; move remaining routes

**Type:** `implementation`

**Description:** Move `/api/organize*`, `/api/chat`, `/api/chat/status`,
`/api/chat/options`, `/api/library/reindex`, and `/healthz` into
`api/routes/organize.py`, `api/routes/chat.py`, and `api/routes/system.py`.
Move `routes_notepad.py`, `routes_chat_sessions.py`, and `routes_spa.py` into
`api/routes/`. All route modules expose `register(app, **deps)`.
`routes_chat_sessions.py` (499 lines, owns `SessionTaskHub` and the run/SSE
orchestration) moves as-is; splitting the hub and runner out of the route module is a
separate follow-up, not part of this restructure.

**Acceptance criteria:**
- [ ] No route decorators remain in `app.py`.
- [ ] Organizer, stateless chat, options, reindex, health, notepad, session, and SPA tests pass.
- [ ] Each route module has one resource and explicit keyword dependencies.

**Verification:**
- [ ] `uv run pytest -q tests/test_organize.py tests/test_chat.py tests/test_chat_sessions.py tests/test_spa_shell.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `rg '@app\\.(get|post|patch|delete)' src/book_reader/app.py` is empty.

**Dependencies:** Task 10

**Files likely touched:** seven route modules, app, tests.

**Estimated scope:** Large (7 route files; moves/extraction only).

### Task 12: Slim `app.py`; move services composition

**Type:** `implementation`

**Description:** Move `Services`, `build_services`, `DEFAULT_ES_INDEX`, and the
request-size/route constants to `services.py`. `app.py` becomes the FastAPI
factory: acquire the process lock, build services, run startup reindex/retention,
register middleware/mount/routes, and return the app. Update `__main__.py`,
tests, and scripts.

**Acceptance criteria:**
- [ ] `app.py` contains no store construction and no route bodies.
- [ ] `create_app` still accepts the same keyword seams used by tests.
- [ ] CLI flags, startup reindex, chat retention cleanup, and process lock behavior are unchanged.
- [ ] `Services` imports from `book_reader.services` in tests.

**Verification:**
- [ ] `uv run pytest -q tests/test_cli.py tests/test_state_lock.py tests/test_organize.py tests/test_reindex.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.app import create_app; from book_reader.services import Services, build_services"`

**Dependencies:** Task 11

**Files likely touched:** `app.py`, new `services.py`, `__main__.py`, tests.

**Estimated scope:** Medium (2 owned files; import/test updates).

## Checkpoint: API and composition

- [ ] `app.py` is under ~180 lines.
- [ ] Every HTTP route is registered from `api/routes/`.
- [ ] No domain module imports `fastapi`.
- [ ] Full Python suite and SPA shell tests pass.

### Task 13: Mirror tests under `tests/<package>/`

**Type:** `verification`

**Description:** Move test modules into `tests/api`, `tests/library`,
`tests/reading`, `tests/search`, `tests/chat`, `tests/organize`, `tests/state`, and
`tests/evals`. Keep `conftest.py` at the root. Mapping for the chat-era tests:
`test_chat.py`, `test_chat_sessions.py`, `test_chats.py`, `test_models.py`, and
`test_openui_contract.py` -> `tests/chat/`; `test_ask_evals.py` -> `tests/evals/`.
Update `pyproject.toml` mypy overrides (`book_reader.pdf` ->
`book_reader.reading.pdf`, plus relaxed test-module names) and any documented
focused-test commands in `CLAUDE.md`.

**Acceptance criteria:**
- [ ] Test directories mirror backend packages.
- [ ] `uv run pytest -q` discovers all tests without path-specific configuration.
- [ ] Mypy overrides reference the new `book_reader.reading.pdf` path and the moved test modules.
- [ ] Test module basenames stay unique, or each test directory has an `__init__.py` (pytest rootdir import mode).
- [ ] No test imports old module paths.

**Verification:**
- [ ] `uv run pytest -q`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `./scripts/ci.sh`

**Dependencies:** Tasks 1-12

**Files likely touched:** test moves, `pyproject.toml`, `CLAUDE.md`.

**Estimated scope:** Medium (test moves; no behavior changes).

### Task 14: Update documentation and final gate

**Type:** `delivery`

**Description:** Add ADR-009 for the feature-first backend layout (ADR-006 is already
taken by the frontend auto-build record; ADR-008 is the latest) and add its row to
`docs/decisions/README.md`. Update the README project layout, `AGENTS.md`, `CLAUDE.md`
(its architecture bullets cite `chat.py`, `chat_config.py`, `chats.py`, and `models.py`
paths), `docs/book-reader-architecture.html` and `docs/diagrams/` paths, and
`CHANGELOG.md`. Run the full gate, packaging check, and a browser smoke test.

**Acceptance criteria:**
- [ ] ADR-009 documents the layout and import-direction rules.
- [ ] README/AGENTS/CLAUDE show only the new paths.
- [ ] Changelog notes the internal restructure with no behavior change.
- [ ] `./scripts/ci.sh` is green.
- [ ] Wheel contains `static/app/index.html`, `chat/models.json`, `prompts/openui_prompt*.txt`, and `skills/*`, and excludes `evals/`.
- [ ] Docker build or an explicit unavailable-daemon note is recorded.
- [ ] Browser smoke at 1440 and 390 covers library, `/ask`, PDF, Markdown, notepad, chat rail, and options.

**Verification:**
- [ ] `./scripts/ci.sh`
- [ ] `uv build --out-dir /tmp/br-wheel && unzip -l /tmp/br-wheel/*.whl | rg 'static/app/index.html|chat/models.json|prompts/openui_prompt|skills/'` and `! unzip -l /tmp/br-wheel/*.whl | rg 'book_reader/evals'`
- [ ] `docker build -t book-reader:backend-layout .` (if daemon available)
- [ ] Browser checklist against a temporary library and state directory.

**Dependencies:** Task 13

**Files likely touched:** ADR-009, `docs/decisions/README.md`, README, AGENTS, CLAUDE,
architecture diagram, changelog.

**Estimated scope:** Medium (docs only).

## Checkpoint: Complete

- [ ] All task acceptance criteria are checked.
- [ ] Full Python and frontend gates pass.
- [ ] No old flat-module imports remain.
- [ ] No behavior, API, state-file, or CLI changes.
- [ ] `git status` contains only intended source/test/docs moves.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Import cycles after moving reindex | High | Keep `state/remap.py` low-level; only `reindex` imports stores, never the reverse; run import smoke after each move. |
| Optional LangChain import becomes eager | High | Keep `chat/__init__.py` empty; import agent/providers/tools inside `build_services` and handlers. |
| Domain error mapping changes status codes | High | Map invalid path → 400, missing/hidden → 404, unknown model → 400; preserve existing tests before/after. |
| Test monkeypatches break after module moves | Medium | Update paths explicitly (`book_reader.chat.sessions.time`); run focused suites per task. |
| Mypy strict overrides drift | Medium | Update `book_reader.reading.pdf` and test module names in Task 13; run mypy each task. |
| Mechanical import churn hides a behavior edit | Medium | Move-only diffs first; no logic edits in move tasks; review by module boundary. |
| Route extraction changes registration order | Medium | Keep `register()` order and middleware/mount order identical; SPA shell fallback tests catch precedence errors. |
| Emptying `chat/__init__.py` breaks callers or eagerly imports langchain | High | Task 6 import-smoke runs with langchain blocked; grep for `from book_reader.chat import`; `scripts/eval_ask.py --help` as a CLI smoke. |
| Registry JSON not packaged after moving to `chat/` | Medium | Wheel check in Task 14 lists `chat/models.json`; `tests/test_models.py` loads it. |
| Static/vendor paths break | Low | Do not move `static/`; `PACKAGE_DIR` remains the package root. |

## Open questions

- **Route style:** retain explicit `register(app, **deps)` (recommended) instead
  of introducing `Depends`/`app.state` service lookup. This keeps optional
  imports and test seams visible.
- **Test layout:** mirror packages (recommended) or keep flat test modules. The
  plan assumes mirrored directories in Task 13.
- **Reindex naming:** `reindex/` is preferred over `maintenance/` because the
  package owns the specific manifest/backup/remap transaction.
- **Public imports:** there are no external Python consumers; old module paths
  can be removed without compatibility shims.

## Definition of Done

- [ ] Every task's acceptance criteria are met.
- [ ] Verification commands were actually run; outcomes are recorded in
      `tasks/todo.md`.
- [ ] `./scripts/ci.sh` passes at the final tree.
- [ ] Python (224) and frontend (249) tests remain at least at the baseline count.
- [ ] Wheel/Docker packaging contracts are unchanged.
- [ ] README/AGENTS/CLAUDE/ADR/changelog reflect the new layout.
- [ ] No HTTP types in domain packages, no old flat-module imports, no shims.
- [ ] `tasks/checkpoint.md` records the final state and next action.
