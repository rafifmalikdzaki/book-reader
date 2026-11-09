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

- [ ] `uv run pytest -q`
- [ ] Old state/library/reading/notes paths removed.

## Phase 2: Large domains

- [x] Task 5: Split `search.py` into `search/`.
      search/ = types, text, elastic, pageindex, service; pytest 224 passed; ruff + mypy clean; benchmark_rag --help ok. Added text.py for shared helpers (renamed public: query_terms, snippet_around, title_score, markdown_chunk, optional_int).
- [ ] Task 6: Fold flat chat modules (`chat_types`, `chat_providers`, `chat_config`, `chats`,
      `models`) into `chat/`; empty `chat/__init__.py`.
- [ ] Task 7: Split `organize.py` into `organize/`.
- [ ] Task 8: Move reindex into `reindex/` with manifest/reconciler split.

## Checkpoint: Domains

- [ ] `uv run pytest -q`
- [ ] Domain import graph is acyclic; `import book_reader.app` works with langchain blocked.

## Phase 3: API boundary

- [ ] Task 9: Extract `api/security.py`, `api/errors.py`; decouple domain errors.
- [ ] Task 10: Extract library/reading/search routes and views.
- [ ] Task 11: Extract organize/chat/system routes; move remaining routes.
- [ ] Task 12: Slim `app.py`; move `Services`/`build_services` to `services.py`.

## Checkpoint: API

- [ ] No route bodies in `app.py`.
- [ ] `uv run pytest -q`
- [ ] SPA shell and HTTP status tests unchanged.

## Phase 4: Tests and docs

- [ ] Task 13: Mirror tests under `tests/<package>/` (incl. `tests/chat`, `tests/evals`).
- [ ] Task 14: Update docs, ADR-009, changelog; final gate and packaging check.

## Checkpoint: Complete

- [ ] `./scripts/ci.sh`
- [ ] Wheel has SPA, `chat/models.json`, prompts, skills; excludes `evals/`.
- [ ] Browser smoke at 1440 and 390.
- [ ] No old paths or shims remain.
- [ ] Every verification command outcome recorded.
