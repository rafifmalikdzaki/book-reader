"""Path-resolution failures. Domain errors only: the HTTP layer maps them to 400/404."""

from __future__ import annotations


class LibraryError(Exception):
    """A client-supplied library path cannot be served."""

    detail = "invalid path"


class InvalidPath(LibraryError):
    """The path is malformed, escapes the library, or is not a book file."""

    detail = "invalid path"


class PathNotFound(LibraryError):
    """The path is missing, hidden, or not a regular file."""

    detail = "not found"
