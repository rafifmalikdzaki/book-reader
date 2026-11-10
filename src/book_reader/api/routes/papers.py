"""Paper import by DOI / arXiv id, and the keywords embedded in library PDFs."""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from ...library.scan import Library
from ...papers.service import PaperService


class ImportBody(BaseModel):
    identifier: str = Field(min_length=1, max_length=400)


def register(app: FastAPI, *, papers: PaperService, library: Library) -> None:
    """Attach /api/papers/import and /api/papers/keywords."""

    @app.post("/api/papers/import")
    def api_papers_import(body: ImportBody) -> dict[str, object]:
        return papers.import_paper(body.identifier)

    @app.get("/api/papers/keywords")
    def api_papers_keywords() -> dict[str, object]:
        return {"books": papers.keywords(library.scan())}
