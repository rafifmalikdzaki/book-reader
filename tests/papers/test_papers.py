"""Paper import: identifier parsing, registry lookups and the download guard, all offline."""

from __future__ import annotations

from pathlib import Path

import httpx
import pymupdf
import pytest
from fastapi.testclient import TestClient

from book_reader.library.scan import Library
from book_reader.papers.errors import InvalidIdentifier, NoOpenAccessPdf, PaperNotFound
from book_reader.papers.fetch import PaperFetcher
from book_reader.papers.identifiers import PaperId, parse_identifier
from book_reader.papers.service import PaperService, paper_filename, split_keywords

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2403.04807v1</id>
    <published>2024-03-07T00:00:00Z</published>
    <title>Mathematics of
      Neural Networks</title>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <category term="cs.LG"/>
    <category term="math.XX"/>
  </entry>
</feed>"""

EMPTY_FEED = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'


def pdf_bytes() -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "paper body")
    data = bytes(doc.tobytes())
    doc.close()
    return data


def fetcher(handler: httpx.MockTransport, *, public: bool = True) -> PaperFetcher:
    return PaperFetcher(transport=handler, host_check=lambda _host: public)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2403.04807", PaperId("arxiv", "2403.04807")),
        ("arXiv:2403.04807v2", PaperId("arxiv", "2403.04807v2")),
        ("https://arxiv.org/abs/2403.04807", PaperId("arxiv", "2403.04807")),
        ("https://doi.org/10.48550/arXiv.2403.04807", PaperId("arxiv", "2403.04807")),
        ("10.1038/s41586-021-03819-2", PaperId("doi", "10.1038/s41586-021-03819-2")),
        ("doi: 10.1000/xyz123.", PaperId("doi", "10.1000/xyz123")),
        ("arXiv:hep-th/9901001", PaperId("arxiv", "hep-th/9901001")),
    ],
)
def test_identifiers_are_recognised_in_pasted_forms(text: str, expected: PaperId) -> None:
    assert parse_identifier(text) == expected


@pytest.mark.parametrize("text", ["", "   ", "a book about cats", "x" * 500])
def test_text_without_an_identifier_is_rejected(text: str) -> None:
    with pytest.raises(InvalidIdentifier):
        parse_identifier(text)


def test_arxiv_import_saves_the_pdf_with_its_metadata(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "export.arxiv.org":
            return httpx.Response(200, text=ARXIV_FEED)
        assert str(request.url) == "https://arxiv.org/pdf/2403.04807"
        return httpx.Response(200, content=pdf_bytes())

    library = Library(tmp_path)
    service = PaperService(library, fetcher(httpx.MockTransport(handler)))

    result = service.import_paper("arXiv:2403.04807")

    assert result["created"] is True
    assert result["rel"] == "Papers/Lovelace 2024 - Mathematics of Neural Networks.pdf"
    assert result["keywords"] == ["Machine Learning", "math.XX"]
    saved = tmp_path / str(result["rel"])
    with pymupdf.open(saved) as doc:
        assert doc.metadata["title"] == "Mathematics of Neural Networks"
        assert doc.metadata["author"] == "Ada Lovelace; Alan Turing"
    assert not list((tmp_path / "Papers").glob(".import-*"))

    keywords = service.keywords(library.scan(force=True))
    assert keywords[str(result["rel"])]["keywords"] == ["Machine Learning", "math.XX"]
    assert keywords[str(result["rel"])]["doi"] == "10.48550/arXiv.2403.04807"

    # A second import finds the file and downloads nothing.
    again = service.import_paper("2403.04807")
    assert again["created"] is False and again["rel"] == result["rel"]


def test_unknown_arxiv_id_is_not_found(tmp_path: Path) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, text=EMPTY_FEED))
    service = PaperService(Library(tmp_path), fetcher(transport))
    with pytest.raises(PaperNotFound):
        service.import_paper("2403.04807")
    assert not (tmp_path / "Papers").exists()


def crossref(links: list[dict[str, str]]) -> dict[str, object]:
    return {
        "message": {
            "title": ["Open Paper"],
            "author": [{"given": "Grace", "family": "Hopper"}],
            "issued": {"date-parts": [[2021, 5]]},
            "subject": ["Compilers"],
            "link": links,
        }
    }


def test_doi_import_follows_a_redirect_to_the_pdf(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.crossref.org":
            return httpx.Response(
                200,
                json=crossref(
                    [{"URL": "https://pub.example/a.pdf", "content-type": "application/pdf"}]
                ),
            )
        if request.url.path == "/a.pdf":
            return httpx.Response(302, headers={"location": "https://cdn.example/real.pdf"})
        return httpx.Response(200, content=pdf_bytes())

    service = PaperService(Library(tmp_path), fetcher(httpx.MockTransport(handler)))
    result = service.import_paper("10.1000/open")
    assert result["rel"] == "Papers/Hopper 2021 - Open Paper.pdf"
    assert result["keywords"] == ["Compilers"]


def test_doi_without_an_open_pdf_fails_honestly(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.crossref.org":
            return httpx.Response(
                200,
                json=crossref(
                    [{"URL": "https://pub.example/wall", "content-type": "application/pdf"}]
                ),
            )
        return httpx.Response(200, text="<html>Sign in</html>")

    service = PaperService(Library(tmp_path), fetcher(httpx.MockTransport(handler)))
    with pytest.raises(NoOpenAccessPdf):
        service.import_paper("10.1000/closed")
    with pytest.raises(NoOpenAccessPdf):
        PaperService(
            Library(tmp_path),
            fetcher(httpx.MockTransport(lambda _r: httpx.Response(200, json=crossref([])))),
        ).import_paper("10.1000/nolinks")
    assert not list(tmp_path.rglob("*.pdf"))


def test_pdf_links_to_private_or_plain_http_hosts_are_refused(tmp_path: Path) -> None:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.host == "api.crossref.org":
            return httpx.Response(
                200,
                json=crossref(
                    [
                        {"URL": "http://pub.example/a.pdf", "content-type": "application/pdf"},
                        {"URL": "https://intranet.local/a.pdf", "content-type": "application/pdf"},
                    ]
                ),
            )
        return httpx.Response(200, content=pdf_bytes())

    service = PaperService(Library(tmp_path), fetcher(httpx.MockTransport(handler), public=False))
    with pytest.raises(NoOpenAccessPdf):
        service.import_paper("10.1000/ssrf")
    assert all("api.crossref.org" in url for url in requested)


def test_filenames_and_keywords_are_sanitised() -> None:
    from book_reader.papers.fetch import Paper

    name = paper_filename(
        Paper(source="doi", identifier="x", title='A/B: "C" <D>\n?', authors=["Émile Zola"])
    )
    assert name == "Zola - A B C D.pdf"
    assert "/" not in name and ".." not in name
    assert split_keywords("ML; ml ;  Deep  Learning,x") == ["ML", "Deep Learning"]
    assert split_keywords("www.it-ebooks.info; Heuristic; https://x.org/a") == ["Heuristic"]
    assert split_keywords("0123814790 9780123814791; Data mining") == ["Data mining"]


def test_import_endpoint_maps_domain_errors(client: tuple[TestClient, Path]) -> None:
    test_client, _state = client
    response = test_client.post("/api/papers/import", json={"identifier": "not an id"})
    assert response.status_code == 400
    assert "DOI" in response.json()["detail"]
    assert test_client.get("/api/papers/keywords").json() == {"books": {}}
