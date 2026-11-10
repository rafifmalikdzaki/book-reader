"""Paper import failures. Domain errors only: the HTTP layer maps ``status`` to a response."""

from __future__ import annotations


class PaperError(Exception):
    """A paper could not be imported; ``detail`` is safe to show the user."""

    status = 502

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class InvalidIdentifier(PaperError):
    """The text is neither a DOI nor an arXiv id."""

    status = 400


class PaperNotFound(PaperError):
    """The registry does not know this identifier."""

    status = 404


class NoOpenAccessPdf(PaperError):
    """The paper exists but no freely downloadable PDF was found."""

    status = 422


class UpstreamFailed(PaperError):
    """arXiv, Crossref or the publisher did not answer usefully."""

    status = 502
