# Checkpoint

## Current phase

Phase 1, Task 1 done (`state/` package: `lock.py`, `remap.py`, `preferences.py`). Tasks 2-14 not started.

## Last verified state

- Commit: `3bffff1` (`feat(ask): stream the agent's live process, tool calls and found documents`)
- Python: 224 passed (`uv run pytest -q`); frontend: 249 passed, tsc/eslint clean.
- Plan changes since `bbac1cb`: chat tasks merged into one (Task 6) because `chat/` is already
  split; 14 tasks; ADR-009 (not 006); packaging check added.

## Next action

Task 2: create `library/` (`scan.py`, `models.py`), move `library.py`, update imports.

## Blockers

None.
