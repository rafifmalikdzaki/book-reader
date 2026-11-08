# Implementation Plan: Feature-first backend restructure

## Overview

The React application is organized by feature, but the Python backend is a flat
directory of 25 modules. HTTP adapters, domain services, JSON persistence, and
infrastructure concerns are mixed together: `app.py` is 602 lines and owns both
application construction and a dozen inline routes; `search.py` (821 lines),
`chat.py` (752), `reconcile.py` (685), and `organize.py` (556) combine several
responsibilities; `library.py` and `chat_config.py` import FastAPI solely to
raise HTTP errors.

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
  notes/
    __init__.py
    store.py                  NotepadStore, groups, notes, export
  chat/
    __init__.py               Empty on purpose: keeps optional imports lazy
    agent.py                  ChatService, LangGraph graph, prompt
    providers.py              ProviderConfig, resolve_providers, model options
    tools.py                  search_library/read_document/add_note tools
    config.py                 Request limits, model selection (no FastAPI)
    sessions.py               Chat sessions, projects, retention
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
  static/                     unchanged
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
   modules remain.
7. **No behavior change.** Move and split first; do not rename endpoints, alter
   state keys, change error text, or add validation.
8. **Lazy optional imports.** `chat/__init__.py` must not import `agent`,
   `providers`, or `tools`, because LangChain/LangGraph are optional. Import
   those modules only inside `build_services()` and request handlers.

## Task List

### Phase 0: Baseline

- [ ] Record baseline: `./scripts/ci.sh` at `7b16aa1` (171 Python, 187 frontend).
- [ ] Capture current module/import map; confirm no pre-existing `tasks/plan.md`.

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
- [ ] Task 6: Split `chat.py` into agent, providers, and tools.
- [ ] Task 7: Move chat config and sessions into `chat/`.
- [ ] Task 8: Split `organize.py` into `organize/`.
- [ ] Task 9: Move reindex into `reindex/` with manifest/reconciler split.

### Checkpoint: Domains

- [ ] No old search/chat/organize/reconcile module paths remain.
- [ ] Domain import graph is acyclic; optional chat imports stay lazy.
- [ ] Focused domain tests pass.

### Phase 3: API boundary and composition root

- [ ] Task 10: Extract `api/security.py`, `api/errors.py`; decouple domain errors.
- [ ] Task 11: Extract library/reading/search routes and shared views.
- [ ] Task 12: Extract organize/chat/system routes; move existing route modules.
- [ ] Task 13: Slim `app.py`; move `Services` and `build_services` to `services.py`.

### Checkpoint: API

- [ ] No route bodies or service construction remain in `app.py`.
- [ ] HTTP status codes, payloads, and headers are unchanged.
- [ ] SPA shell and API tests pass.

### Phase 4: Tests and documentation

- [ ] Task 14: Mirror tests under `tests/<package>/`; update mypy/CI paths.
- [ ] Task 15: Update docs, ADR-006, changelog; final full gate and browser smoke.

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
current `HTTPException` behavior until Task 10; this task only changes ownership.

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

**Description:** Replace the 821-line `search.py` with four focused modules:
`types.py` (`SearchHit`, `SearchUnavailable`), `elastic.py` (`ElasticSearch`,
`RebuildJob` and Elasticsearch helpers), `pageindex.py` (`PageIndexSearch`), and
`service.py` (`Searcher` plus local scan/snippet helpers). No retrieval behavior
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

### Task 6: Split `chat.py` into agent, providers, and tools

**Type:** `implementation`

**Description:** Move provider configuration and resolution to
`chat/providers.py`, tool schemas/builders and source helpers to `chat/tools.py`,
and `ChatService` plus the LangGraph graph to `chat/agent.py`. Keep
`chat/__init__.py` empty to preserve lazy optional imports. No prompt or tool
behavior changes.

**Acceptance criteria:**
- [ ] Importing `book_reader.app` without LangChain installed still succeeds.
- [ ] `ChatService`, `ProviderConfig`, and tool builders import from their new modules.
- [ ] Provider fallback, bounded tool rounds, and source collection tests pass.

**Verification:**
- [ ] `uv run pytest -q tests/test_chat.py tests/test_chat_sessions.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "import book_reader.app; import book_reader.chat"`

**Dependencies:** Tasks 1-5

**Files likely touched:** `chat.py`, new `chat/agent.py`, `chat/providers.py`,
`chat/tools.py`, `chat/__init__.py`, routes/tests.

**Estimated scope:** Large (4 owned files; one module deletion; import updates).

### Task 7: Move chat config and sessions into `chat/`

**Type:** `implementation`

**Description:** Move `chat_config.py` to `chat/config.py` and `chats.py` to
`chat/sessions.py`. Remove FastAPI from the config model selection path only in
Task 10; this task preserves behavior and updates tests that monkeypatch
`book_reader.chats.time`.

**Acceptance criteria:**
- [ ] Session/project types and `ChatStore` import from `chat/sessions.py`.
- [ ] Model limits and selection import from `chat/config.py`.
- [ ] Retention monkeypatches target the new module path and still pass.
- [ ] No `book_reader.chats` or `book_reader.chat_config` imports remain.

**Verification:**
- [ ] `uv run pytest -q tests/test_chats.py tests/test_chat_sessions.py tests/test_reindex.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `uv run python -c "from book_reader.chat.sessions import ChatStore; from book_reader.chat.config import select_model"`

**Dependencies:** Task 6

**Files likely touched:** two moved modules, three route/app/reindex modules, tests.

**Estimated scope:** Small (2 owned files; import updates).

### Task 8: Split `organize.py` into `organize/`

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

### Task 9: Move reindex into `reindex/`

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

**Dependencies:** Tasks 1-8

**Files likely touched:** `reconcile.py`, new `reindex/*.py`, app/routes/services,
tests.

**Estimated scope:** Large (3 owned files; one module deletion; import updates).

## Checkpoint: Domains

- [ ] Full Python suite passes.
- [ ] `rg 'book_reader\.(library|pdf|mdrender|pages|progress|sections|notepad|search|chat|chats|chat_config|organize|reconcile|state_lock|statemove|preferences)' src tests scripts` is empty.
- [ ] Optional chat import remains lazy.
- [ ] No behavior or state-file changes in the diff.

### Task 10: Extract `api/security.py`, `api/errors.py`; decouple domain errors

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

**Dependencies:** Tasks 2, 7, 9

**Files likely touched:** `security_headers.py`, new `api/security.py`,
`api/errors.py`, `library/errors.py`, `library/scan.py`, `chat/config.py`, app,
tests.

**Estimated scope:** Medium (6 owned files; behavior-preserving error mapping).

### Task 11: Extract library/reading/search routes and shared views

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

**Dependencies:** Tasks 9-10

**Files likely touched:** `routes_library.py`, new `api/views.py`, three route
modules, app, tests.

**Estimated scope:** Large (5 owned files; route moves only).

### Task 12: Extract organize/chat/system routes; move remaining routes

**Type:** `implementation`

**Description:** Move `/api/organize*`, `/api/chat`, `/api/chat/status`,
`/api/chat/options`, `/api/library/reindex`, and `/healthz` into
`api/routes/organize.py`, `api/routes/chat.py`, and `api/routes/system.py`.
Move `routes_notepad.py`, `routes_chat_sessions.py`, and `routes_spa.py` into
`api/routes/`. All route modules expose `register(app, **deps)`.

**Acceptance criteria:**
- [ ] No route decorators remain in `app.py`.
- [ ] Organizer, stateless chat, options, reindex, health, notepad, session, and SPA tests pass.
- [ ] Each route module has one resource and explicit keyword dependencies.

**Verification:**
- [ ] `uv run pytest -q tests/test_organize.py tests/test_chat.py tests/test_chat_sessions.py tests/test_spa_shell.py`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `rg '@app\\.(get|post|patch|delete)' src/book_reader/app.py` is empty.

**Dependencies:** Task 11

**Files likely touched:** seven route modules, app, tests.

**Estimated scope:** Large (7 route files; moves/extraction only).

### Task 13: Slim `app.py`; move services composition

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

**Dependencies:** Task 12

**Files likely touched:** `app.py`, new `services.py`, `__main__.py`, tests.

**Estimated scope:** Medium (2 owned files; import/test updates).

## Checkpoint: API and composition

- [ ] `app.py` is under ~180 lines.
- [ ] Every HTTP route is registered from `api/routes/`.
- [ ] No domain module imports `fastapi`.
- [ ] Full Python suite and SPA shell tests pass.

### Task 14: Mirror tests under `tests/<package>/`

**Type:** `verification`

**Description:** Move test modules into `tests/api`, `tests/library`,
`tests/reading`, `tests/search`, `tests/chat`, `tests/organize`, and
`tests/state`. Keep `conftest.py` at the root. Update `pyproject.toml` mypy
overrides and any documented focused-test commands.

**Acceptance criteria:**
- [ ] Test directories mirror backend packages.
- [ ] `uv run pytest -q` discovers all tests without path-specific configuration.
- [ ] Mypy overrides reference the new `book_reader.reading.pdf` path.
- [ ] No test imports old module paths.

**Verification:**
- [ ] `uv run pytest -q`
- [ ] `uv run ruff check src tests && uv run mypy src tests`
- [ ] `./scripts/ci.sh`

**Dependencies:** Tasks 1-13

**Files likely touched:** test moves, `pyproject.toml`, `CLAUDE.md`.

**Estimated scope:** Medium (test moves; no behavior changes).

### Task 15: Update documentation and final gate

**Type:** `delivery`

**Description:** Add ADR-006 for the feature-first backend layout, update the
README project layout, `AGENTS.md`, `CLAUDE.md`, architecture diagram paths, and
the changelog. Run the full gate, packaging check, and a browser smoke test.

**Acceptance criteria:**
- [ ] ADR-006 documents the layout and import-direction rules.
- [ ] README/AGENTS/CLAUDE show only the new paths.
- [ ] Changelog notes the internal restructure with no behavior change.
- [ ] `./scripts/ci.sh` is green.
- [ ] Wheel contains the SPA; Docker build or an explicit unavailable-daemon note is recorded.
- [ ] Browser smoke at 1440 and 390 covers library, `/ask`, PDF, Markdown, notepad, chat rail, and options.

**Verification:**
- [ ] `./scripts/ci.sh`
- [ ] `uv build --out-dir /tmp/br-wheel && unzip -l /tmp/br-wheel/*.whl | rg 'static/app/index.html'`
- [ ] `docker build -t book-reader:backend-layout .` (if daemon available)
- [ ] Browser checklist against a temporary library and state directory.

**Dependencies:** Task 14

**Files likely touched:** ADR, README, AGENTS, CLAUDE, architecture diagram,
changelog.

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
| Mypy strict overrides drift | Medium | Update `book_reader.reading.pdf` and test module names in Task 14; run mypy each task. |
| Mechanical import churn hides a behavior edit | Medium | Move-only diffs first; no logic edits in move tasks; review by module boundary. |
| Route extraction changes registration order | Medium | Keep `register()` order and middleware/mount order identical; SPA shell fallback tests catch precedence errors. |
| Static/vendor paths break | Low | Do not move `static/`; `PACKAGE_DIR` remains the package root. |

## Open questions

- **Route style:** retain explicit `register(app, **deps)` (recommended) instead
  of introducing `Depends`/`app.state` service lookup. This keeps optional
  imports and test seams visible.
- **Test layout:** mirror packages (recommended) or keep flat test modules. The
  plan assumes mirrored directories in Task 14.
- **Reindex naming:** `reindex/` is preferred over `maintenance/` because the
  package owns the specific manifest/backup/remap transaction.
- **Public imports:** there are no external Python consumers; old module paths
  can be removed without compatibility shims.

## Definition of Done

- [ ] Every task's acceptance criteria are met.
- [ ] Verification commands were actually run; outcomes are recorded in
      `tasks/todo.md`.
- [ ] `./scripts/ci.sh` passes at the final tree.
- [ ] Python and frontend tests remain at least at the baseline coverage.
- [ ] Wheel/Docker packaging contracts are unchanged.
- [ ] README/AGENTS/CLAUDE/ADR/changelog reflect the new layout.
- [ ] No HTTP types in domain packages, no old flat-module imports, no shims.
- [ ] `tasks/checkpoint.md` records the final state and next action.
