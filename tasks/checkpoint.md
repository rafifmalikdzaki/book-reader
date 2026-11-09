# Checkpoint

## Current phase

Task 11 done. Task 12: move Services/build_services to services.py; slim app.py (move GzipStaticFiles + cache middleware to api/static.py).

## Last verified state

- Commit: `3bffff1` (`feat(ask): stream the agent's live process, tool calls and found documents`)
- Python: 224 passed (`uv run pytest -q`); frontend: 249 passed, tsc/eslint clean.
- Plan changes since `bbac1cb`: chat tasks merged into one (Task 6) because `chat/` is already
  split; 14 tasks; ADR-009 (not 006); packaging check added.

## Next action

Task 12: move Services/build_services to services.py; slim app.py (move GzipStaticFiles + cache middleware to api/static.py).

## Blockers

None.
