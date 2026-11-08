"""FastAPI application: library index, book views, page rendering, search, progress."""

from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .library import Library
from .mdrender import render_markdown_file
from .notepad import NotepadStore
from .pages import PageIndex
from .pdf import PdfCache
from .progress import ProgressStore
from .routes_notepad import register as register_notepad
from .search import ElasticSearch, Searcher, SearchUnavailable
from .sections import SectionIndex

PACKAGE_DIR = Path(__file__).parent
TEMPLATES = Jinja2Templates(directory=str(PACKAGE_DIR / "templates"))
ZOOM_MIN = 0.5
ZOOM_MAX = 3.0
SEARCH_LIMIT_MAX = 200
RECENT_LIMIT = 5
DEFAULT_ES_INDEX = "book-reader"


class ProgressBody(BaseModel):
    path: str
    page: int | None = None
    scroll: float | None = None


@dataclass(frozen=True)
class Services:
    """Everything the HTTP layer needs, built once per process."""

    root: Path
    library: Library
    pdf: PdfCache
    pages: PageIndex
    progress: ProgressStore
    notepad: NotepadStore
    sections: SectionIndex
    elastic: ElasticSearch | None
    searcher: Searcher


def build_services(
    library_root: Path,
    state_dir: Path,
    *,
    es_url: str | None = None,
    es_index: str | None = None,
) -> Services:
    root = Path(library_root).resolve()
    state = Path(state_dir)
    url = es_url if es_url is not None else os.environ.get("BOOK_READER_ES_URL", "")
    index = es_index or os.environ.get("BOOK_READER_ES_INDEX", DEFAULT_ES_INDEX)
    pdf = PdfCache()
    sections = SectionIndex(state)
    library = Library(root)
    elastic = ElasticSearch(url, index, pdf, sections, state) if url else None
    return Services(
        root=root,
        library=library,
        pdf=pdf,
        pages=PageIndex(state, pdf),
        progress=ProgressStore(state),
        notepad=NotepadStore(state),
        sections=sections,
        elastic=elastic,
        searcher=Searcher(library, pdf, sections, elastic),
    )


def create_app(
    library_root: Path,
    state_dir: Path,
    *,
    es_url: str | None = None,
    es_index: str | None = None,
) -> FastAPI:
    """Build the app with its own library, caches, and stores."""
    services = build_services(library_root, state_dir, es_url=es_url, es_index=es_index)
    root = services.root
    library = services.library
    pdf = services.pdf
    pages = services.pages
    progress = services.progress
    sections = services.sections
    elastic = services.elastic
    searcher = services.searcher

    app = FastAPI(title="book-reader", docs_url=None, redoc_url=None)
    app.mount("/static", StaticFiles(directory=str(PACKAGE_DIR / "static")), name="static")
    register_notepad(app, notepad=services.notepad, library=library, pdf=pdf)

    def render(template: str, request: Request, **context: object) -> HTMLResponse:
        return TEMPLATES.TemplateResponse(request, template, {"library_root": str(root), **context})

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> HTMLResponse:
        books = library.scan()
        titles = {book.rel: book.title for book in books}
        recent = [
            {
                "rel": rel,
                "title": titles.get(rel, Path(rel).stem),
                "page": entry.get("page"),
            }
            for rel, entry in progress.recent(RECENT_LIMIT)
        ]
        return render(
            "index.html",
            request,
            groups=library.groups(),
            recent=recent,
            book_count=len(books),
            search_backend=searcher.backend(),
        )

    @app.get("/book/{rel:path}", response_class=HTMLResponse)
    def book(request: Request, rel: str) -> HTMLResponse:
        target = library.book_file(rel)
        title = Path(rel).stem
        stored = progress.get(rel) or {"page": None, "scroll": None}

        if target.suffix.lower() == ".md":
            try:
                body = render_markdown_file(target, file_rel=rel)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"cannot read {rel}") from exc
            return render(
                "book_md.html",
                request,
                rel=rel,
                title=title,
                html=body,
                progress=stored,
                error=None,
            )

        count = pages.count(rel, target)
        if count is None:
            return render(
                "book_pdf.html",
                request,
                rel=rel,
                title=title,
                page=1,
                page_count=0,
                toc=[],
                progress=stored,
                error=f"Cannot open {title}: not a readable PDF",
            )
        requested = str(request.query_params.get("page") or stored.get("page") or 1)
        try:
            current = int(requested)
        except ValueError:
            current = 1
        current = max(1, min(count, current))
        return render(
            "book_pdf.html",
            request,
            rel=rel,
            title=title,
            page=current,
            page_count=count,
            toc=pdf.toc(target),
            progress=stored,
            error=None,
        )

    @app.get("/page.png")
    def page_image(
        request: Request,
        rel: Annotated[str, Query(alias="path")],
        page_number: Annotated[int, Query(alias="page")] = 1,
        zoom: Annotated[float, Query()] = 1.0,
    ) -> Response:
        target = library.book_file(rel)
        if target.suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail="not a PDF")
        count = pages.count(rel, target)
        if count is None:
            raise HTTPException(status_code=400, detail="cannot open PDF")
        if not 1 <= page_number <= count:
            raise HTTPException(status_code=400, detail=f"page out of range: {page_number}")
        zoom = min(ZOOM_MAX, max(ZOOM_MIN, zoom))

        stat = target.stat()
        etag = f'W/"{int(stat.st_mtime)}-{stat.st_size}-{page_number}-{zoom:.2f}"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        try:
            png = pdf.render(target, page_number, zoom)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"cannot render page: {exc}") from exc
        return Response(
            png,
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=3600", "ETag": etag},
        )

    @app.get("/raw/{rel:path}")
    def raw(rel: str) -> FileResponse:
        target = library.any_file(rel)
        media_type, _encoding = mimetypes.guess_type(target.name)
        return FileResponse(target, media_type=media_type or "application/octet-stream")

    @app.get("/api/text")
    def api_text(
        rel: Annotated[str, Query(alias="path")],
        page_number: Annotated[int, Query(alias="page")] = 1,
    ) -> dict[str, object]:
        target = library.book_file(rel)
        if target.suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail="not a PDF")
        try:
            layer = pdf.page_words(target, page_number)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"cannot read page text: {exc}") from exc
        layer["section"] = sections.section_for_page(rel, target, page_number)
        return layer

    @app.get("/api/search")
    def api_search(
        q: str = "",
        rel: Annotated[str | None, Query(alias="path")] = None,
        limit: Annotated[int, Query(ge=1, le=SEARCH_LIMIT_MAX)] = 50,
    ) -> dict[str, object]:
        if rel is not None:
            target = library.book_file(rel)
            try:
                hits = searcher.in_book(rel, target, q, limit)
            except OSError as exc:
                raise HTTPException(status_code=400, detail=f"cannot read {rel}") from exc
            kind = "md" if target.suffix.lower() == ".md" else "pdf"
            return {"kind": kind, "backend": searcher.backend(), "hits": hits}
        if not q.strip():
            return {"kind": "library", "backend": searcher.backend(), "hits": []}
        try:
            hits = searcher.library_wide(q, limit)
        except SearchUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"kind": "library", "backend": "elasticsearch", "hits": hits}

    @app.post("/api/progress")
    def api_progress(body: ProgressBody) -> dict[str, bool]:
        library.book_file(body.path)
        if body.page is not None and body.page < 1:
            raise HTTPException(status_code=400, detail="page must be >= 1")
        if body.scroll is not None and not 0.0 <= body.scroll <= 1.0:
            raise HTTPException(status_code=400, detail="scroll must be within 0..1")
        if body.page is None and body.scroll is None:
            raise HTTPException(status_code=400, detail="nothing to record")
        progress.update(body.path, page=body.page, scroll=body.scroll)
        return {"ok": True}

    @app.get("/api/pages")
    def api_pages() -> dict[str, object]:
        books = library.scan()
        counts = pages.counts((book.rel, root / book.rel) for book in books if book.kind == "pdf")
        return {"counts": {book.rel: counts.get(book.rel) for book in books}}

    @app.post("/api/index/rebuild")
    def api_index_rebuild(force: bool = False) -> dict[str, object]:
        if elastic is None:
            raise HTTPException(
                status_code=503,
                detail="Elasticsearch is not configured; set BOOK_READER_ES_URL",
            )
        if not elastic.available():
            raise HTTPException(
                status_code=503, detail=f"Elasticsearch is not reachable at {elastic.url}"
            )
        stats = elastic.rebuild(library, force=force)
        return {"ok": True, **stats, "chunks": elastic.chunk_count()}

    @app.get("/api/index/status")
    def api_index_status() -> dict[str, object]:
        return {
            "elasticsearch": {
                "url": elastic.url if elastic else None,
                "index": elastic.index if elastic else None,
                "available": bool(elastic and elastic.available()),
                "chunks": elastic.chunk_count() if elastic else None,
            },
            "pageindex": sections.available(),
            "search_backend": searcher.backend(),
        }

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    return app
