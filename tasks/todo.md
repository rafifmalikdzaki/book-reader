# Backend restructure — task checklist

Plan: `tasks/plan.md`
Baseline: `7b16aa1`; `./scripts/ci.sh` green (171 Python, 187 frontend).

## Phase 0: Baseline

- [ ] Confirm baseline and module/import map.

## Phase 1: Foundations

- [ ] Task 1: Create `state/` and move lock, remap, preferences.
- [ ] Task 2: Create `library/` and split scan/models.
- [ ] Task 3: Create `reading/` and move reader modules.
- [ ] Task 4: Create `notes/` and move the notepad store.

## Checkpoint: Foundations

- [ ] `uv run pytest -q`
- [ ] Old state/library/reading/notes paths removed.

## Phase 2: Large domains

- [ ] Task 5: Split `search.py` into `search/`.
- [ ] Task 6: Split `chat.py` into agent, providers, and tools.
- [ ] Task 7: Move chat config and sessions into `chat/`.
- [ ] Task 8: Split `organize.py` into `organize/`.
- [ ] Task 9: Move reindex into `reindex/`.

## Checkpoint: Domains

- [ ] `uv run pytest -q`
- [ ] Domain import graph is acyclic; optional chat imports lazy.

## Phase 3: API boundary

- [ ] Task 10: Extract `api/security.py`, `api/errors.py`; decouple domain errors.
- [ ] Task 11: Extract library/reading/search routes and views.
- [ ] Task 12: Extract organize/chat/system routes; move remaining routes.
- [ ] Task 13: Slim `app.py`; move `Services`/`build_services` to `services.py`.

## Checkpoint: API

- [ ] No route bodies in `app.py`.
- [ ] `uv run pytest -q`
- [ ] SPA shell and HTTP status tests unchanged.

## Phase 4: Tests and docs

- [ ] Task 14: Mirror tests under `tests/<package>/`.
- [ ] Task 15: Update docs, ADR-006, changelog; final gate.

## Checkpoint: Complete

- [ ] `./scripts/ci.sh`
- [ ] Wheel SPA check.
- [ ] Browser smoke at 1440 and 390.
- [ ] No old paths or shims remain.
- [ ] Every verification command outcome recorded.
