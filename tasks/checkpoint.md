# Checkpoint

## Current phase

Task 8 done. Task 9: extract api/security.py + api/errors.py; replace HTTPException in library/scan.py and chat/config.py with domain errors.

## Last verified state

- Commit: `3bffff1` (`feat(ask): stream the agent's live process, tool calls and found documents`)
- Python: 224 passed (`uv run pytest -q`); frontend: 249 passed, tsc/eslint clean.
- Plan changes since `bbac1cb`: chat tasks merged into one (Task 6) because `chat/` is already
  split; 14 tasks; ADR-009 (not 006); packaging check added.

## Next action

Task 9: extract api/security.py + api/errors.py; replace HTTPException in library/scan.py and chat/config.py with domain errors.

## Blockers

None.
