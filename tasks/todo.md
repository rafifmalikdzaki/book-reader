# Backend restructure — task checklist

Plan: `tasks/plan.md` (revised for HEAD `3bffff1`)
Baseline: `3bffff1`; 224 Python, 249 frontend tests.

## Phase 0: Baseline

- [x] Baseline at `3bffff1`: pytest 224 passed, vitest 249 passed (this session); import map via `rg`.

## Phase 1: Foundations

- [x] Task 1: Create `state/` and move lock, remap, preferences.
      pytest 224 passed; ruff + mypy src/tests clean; import smoke ok; old paths gone (`rg`).
- [x] Task 2: Create `library/` and split scan/models.
      pytest 224 passed; ruff + mypy clean; import smoke ok.
- [x] Task 3: Create `reading/` and move reader modules.
      pytest 224 passed; ruff + mypy clean; benchmark_rag --help ok.
- [x] Task 4: Create `notes/` and move the notepad store.
      pytest 224 passed; ruff + mypy clean; smoke ok.

## Checkpoint: Foundations

- [x] `uv run pytest -q`
- [x] Old state/library/reading/notes paths removed.

## Phase 2: Large domains

- [x] Task 5: Split `search.py` into `search/`.
      search/ = types, text, elastic, pageindex, service; pytest 224 passed; ruff + mypy clean; benchmark_rag --help ok. Added text.py for shared helpers (renamed public: query_terms, snippet_around, title_score, markdown_chunk, optional_int).
- [x] Task 6: Fold flat chat modules (`chat_types`, `chat_providers`, `chat_config`, `chats`,
      `models`) into `chat/`; empty `chat/__init__.py`.
      pytest 224 passed; ruff + mypy clean; import smoke with langchain blocked ok; eval_ask --help ok; chat/__init__ empty; old paths gone.
- [x] Task 7: Split `organize.py` into `organize/`.
      organize/ = categories, mistral, service; pytest 224 passed; ruff + mypy clean.
- [x] Task 8: Move reindex into `reindex/` with manifest/reconciler split.
      reindex/ = manifest, reconciler, redirects (MoveLog + moved_book_target moved out of routes_library); pytest 224 passed; ruff + mypy clean.

## Checkpoint: Domains

- [x] `uv run pytest -q` (224 passed)
- [x] Domain import graph is acyclic (stores never import `reindex`); `import book_reader.app` works with langchain blocked.

## Phase 3: API boundary

- [x] Task 9: Extract `api/security.py`, `api/errors.py`; decouple domain errors.
      api/{security,errors}.py; library/errors.py (InvalidPath, PathNotFound); chat/config.UnknownModel; no fastapi in domain packages; pytest 224 passed; ruff + mypy clean.
- [x] Task 10: Extract library/reading/search routes and views.
      api/views.py + api/routes/{library,reading,search}.py; OpenAPI path/method table identical before/after (34 paths); pytest 224 passed; ruff + mypy clean.
- [x] Task 11: Extract organize/chat/system routes; move remaining routes.
      api/routes/{chat,organize,system} extracted; routes_notepad/chat_sessions/spa moved into api/routes/; no @app.<verb> left in app.py; OpenAPI table identical (34 paths); pytest 224 passed.
- [x] Task 12: Slim `app.py`; move `Services`/`build_services` to `services.py`.
      services.py (Services, build_services, DEFAULT_ES_INDEX); api/static.py (GzipStaticFiles + cache/gzip middleware); app.py 146 lines, no store construction or route bodies; OpenAPI table identical; pytest 224 passed.

## Checkpoint: API

- [x] No route bodies in `app.py`.
- [x] `uv run pytest -q`
- [x] SPA shell and HTTP status tests unchanged.

## Phase 4: Tests and docs

- [x] Task 13: Mirror tests under `tests/<package>/` (incl. `tests/chat`, `tests/evals`).
      tests/{api,reading,search,chat,organize,state,reindex,evals}/ mirror packages; conftest + test_cli stay at root; pytest 224 passed; mypy src tests clean; state-lock subprocess cwd fixed (parents[2]).
- [x] Task 14: Update docs, ADR-009, changelog; final gate and packaging check.
      ADR-009 + README row, CLAUDE.md/AGENTS.md/CHANGELOG/architecture diagram updated. ./scripts/ci.sh green (224 py, 249 vitest). Wheel has static/app/index.html, chat/models.json, prompts, skills; no evals/. HTTP smoke on restarted server ok (SPA routes, library, book, thumb, search, 400/404 mapping). Not done: Docker build and browser smoke at 1440/390 (extension not connected; docker build skipped).

## Checkpoint: Complete

- [x] `./scripts/ci.sh` (224 py, 249 vitest)
- [x] Wheel has SPA, `chat/models.json`, prompts, skills; excludes `evals/`.
- [ ] Browser smoke at 1440 and 390 (extension not connected; HTTP smoke done instead).
- [ ] Docker build (skipped).
- [x] No old paths or shims remain.
- [x] Every verification command outcome recorded.
