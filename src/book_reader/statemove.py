"""Plan a path remap that also supports swaps.

A reindex can move A->B and B->A in one batch (two books swapped names). The
stores must apply the whole plan from one snapshot, not move keys one by one,
or the second move would collide with the first.
"""

from __future__ import annotations

from collections.abc import Mapping


class RemapError(RuntimeError):
    """A store could not make its migrated state durable."""


def plan_remap(mapping: Mapping[str, str], existing: set[str]) -> tuple[dict[str, str], set[str]]:
    """Return safe one-to-one moves and the sources that must stay put.

    A target is available when it is empty or is itself moving away. Swaps
    therefore work; a target holding state for a book that is staying put is a
    conflict and is never overwritten.
    """
    moves = {old: new for old, new in mapping.items() if old in existing and old != new}
    conflicts: set[str] = set()

    by_target: dict[str, list[str]] = {}
    for old, new in moves.items():
        by_target.setdefault(new, []).append(old)
    for olds in by_target.values():
        if len(olds) > 1:
            conflicts.update(olds)

    for old, new in moves.items():
        if old in conflicts:
            continue
        if new in existing and new not in moves:
            conflicts.add(old)

    changed = True
    while changed:
        changed = False
        for old, new in moves.items():
            if old in conflicts:
                continue
            if new in conflicts:
                conflicts.add(old)
                changed = True

    safe = {old: new for old, new in moves.items() if old not in conflicts}
    return safe, conflicts


def apply_remap[T](entries: dict[str, T], safe: dict[str, str]) -> dict[str, T]:
    """Build a new mapping from the original snapshot, not an in-place walk."""
    if not safe:
        return entries
    result: dict[str, T] = {rel: value for rel, value in entries.items() if rel not in safe}
    for old, new in safe.items():
        result[new] = entries[old]
    return result
