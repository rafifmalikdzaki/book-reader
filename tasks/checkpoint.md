# Checkpoint

## Current phase

Plan revised for the current repo; not started. No source, test, or configuration
changes have been made for the backend restructure.

## Last verified state

- Commit: `3bffff1` (`feat(ask): stream the agent's live process, tool calls and found documents`)
- Python: 224 passed (`uv run pytest -q`); frontend: 249 passed, tsc/eslint clean.
- Plan changes since `bbac1cb`: chat tasks merged into one (Task 6) because `chat/` is already
  split; 14 tasks; ADR-009 (not 006); packaging check added.

## Next action

Start Task 1 after plan approval: create `state/` and move `state_lock.py`,
`statemove.py`, and `preferences.py`; update imports; run the focused test gate.

## Blockers

None.
