"""Library entities: the scanned book record and the virtual 'unfiled' category."""

from __future__ import annotations

from dataclasses import dataclass

UNFILED = "Unfiled"


@dataclass(frozen=True, slots=True)
class Book:
    rel: str  # POSIX-style path relative to the library root
    title: str  # file stem, verbatim
    kind: str  # "pdf" | "md"
    size: int
    mtime: float
