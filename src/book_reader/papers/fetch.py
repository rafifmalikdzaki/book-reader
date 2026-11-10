"""Download one paper's metadata and open-access PDF.

Metadata comes from fixed hosts (arXiv, Crossref, optionally Unpaywall). The PDF link for a
DOI comes out of that metadata, so it is treated as untrusted: https only, public addresses
only, every redirect re-checked, the connection pinned to the address that was checked, and
a size cap.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import BinaryIO
from urllib.parse import quote, urljoin, urlsplit

import httpx

from .errors import NoOpenAccessPdf, PaperNotFound, UpstreamFailed
from .identifiers import PaperId

logger = logging.getLogger(__name__)

ARXIV_API = "https://export.arxiv.org/api/query"
ARXIV_PDF = "https://arxiv.org/pdf/"
CROSSREF_API = "https://api.crossref.org/works/"
UNPAYWALL_API = "https://api.unpaywall.org/v2/"
USER_AGENT = "book-reader (local reading app)"
MAX_PDF_BYTES = 150 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
PDF_MAGIC = b"%PDF-"

_VERSION = re.compile(r"v\d+$")
_ATOM = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}

# Readable names for the arXiv categories a research library meets most; others keep their code.
ARXIV_CATEGORIES = {
    "cs.AI": "Artificial Intelligence",
    "cs.CL": "Computation and Language",
    "cs.CR": "Cryptography and Security",
    "cs.CV": "Computer Vision",
    "cs.DB": "Databases",
    "cs.DC": "Distributed Computing",
    "cs.DS": "Data Structures and Algorithms",
    "cs.HC": "Human-Computer Interaction",
    "cs.IR": "Information Retrieval",
    "cs.IT": "Information Theory",
    "cs.LG": "Machine Learning",
    "cs.NE": "Neural and Evolutionary Computing",
    "cs.NI": "Networking",
    "cs.PL": "Programming Languages",
    "cs.RO": "Robotics",
    "cs.SE": "Software Engineering",
    "eess.IV": "Image and Video Processing",
    "eess.SP": "Signal Processing",
    "math.NA": "Numerical Analysis",
    "math.OC": "Optimization and Control",
    "math.PR": "Probability",
    "math.ST": "Statistics Theory",
    "physics.comp-ph": "Computational Physics",
    "physics.flu-dyn": "Fluid Dynamics",
    "q-bio.QM": "Quantitative Biology",
    "stat.AP": "Applied Statistics",
    "stat.ME": "Statistical Methodology",
    "stat.ML": "Machine Learning",
}


@dataclass(frozen=True, slots=True)
class Paper:
    """What a registry says about one paper, plus where its PDF can be fetched."""

    source: str  # "arxiv" | "doi"
    identifier: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: str = ""
    keywords: list[str] = field(default_factory=list)
    doi: str = ""
    pdf_urls: list[str] = field(default_factory=list)


# Maps a host name to the one address to connect to, or None when the host must be refused.
HostResolver = Callable[[str], str | None]


def public_address(host: str) -> str | None:
    """An address for ``host``, provided every address it resolves to is a public one."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return None
    addresses = list(dict.fromkeys(str(info[4][0]).split("%", 1)[0] for info in infos))
    if not addresses or not all(ipaddress.ip_address(a).is_global for a in addresses):
        return None
    return addresses[0]


def _pinned(url: str, host: str, address: str) -> str:
    """``url`` aimed at ``address``, so the name is not resolved a second time on connect."""
    if address == host:
        return url
    parts = urlsplit(url)
    literal = f"[{address}]" if ":" in address else address
    netloc = f"{literal}:{parts.port}" if parts.port else literal
    return parts._replace(netloc=netloc).geturl()


class PaperFetcher:
    """HTTP side of a paper import. ``transport`` and ``resolve`` are test seams."""

    def __init__(
        self,
        *,
        unpaywall_email: str = "",
        transport: httpx.BaseTransport | None = None,
        resolve: HostResolver = public_address,
    ) -> None:
        self._email = unpaywall_email.strip()
        self._transport = transport
        self._resolve = resolve

    def _client(self) -> httpx.Client:
        return httpx.Client(
            transport=self._transport,
            timeout=TIMEOUT,
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        )

    def describe(self, paper_id: PaperId) -> Paper:
        with self._client() as client:
            if paper_id.kind == "arxiv":
                return self._arxiv(client, paper_id.value)
            return self._doi(client, paper_id.value)

    def download(self, paper: Paper, out: BinaryIO) -> None:
        """Stream the first candidate URL that really returns a PDF into ``out``."""
        if not paper.pdf_urls:
            raise NoOpenAccessPdf(
                "No open-access PDF was found for this DOI. Download it yourself and drop it"
                " into the library folder."
            )
        with self._client() as client:
            for url in paper.pdf_urls:
                try:
                    if self._fetch_pdf(client, url, out):
                        return
                except (httpx.HTTPError, UpstreamFailed) as exc:
                    logger.info("paper pdf candidate failed: %s (%s)", url, exc)
        raise NoOpenAccessPdf(
            "The paper was found, but none of its links returned a readable PDF"
            " (it may be behind a paywall)."
        )

    def _get_json(self, client: httpx.Client, url: str, what: str) -> dict[str, object]:
        try:
            response = client.get(url, headers={"Accept": "application/json"})
        except httpx.HTTPError as exc:
            raise UpstreamFailed(f"{what} could not be reached: {exc}") from exc
        if response.status_code == 404:
            raise PaperNotFound(f"{what} does not know this identifier.")
        if response.status_code != 200:
            raise UpstreamFailed(f"{what} answered with HTTP {response.status_code}.")
        try:
            data = response.json()
        except ValueError as exc:
            raise UpstreamFailed(f"{what} returned an unreadable answer.") from exc
        if not isinstance(data, dict):
            raise UpstreamFailed(f"{what} returned an unreadable answer.")
        return data

    def _arxiv(self, client: httpx.Client, arxiv_id: str) -> Paper:
        try:
            response = client.get(ARXIV_API, params={"id_list": arxiv_id, "max_results": "1"})
        except httpx.HTTPError as exc:
            raise UpstreamFailed(f"arXiv could not be reached: {exc}") from exc
        if response.status_code != 200:
            raise UpstreamFailed(f"arXiv answered with HTTP {response.status_code}.")
        try:
            feed = ET.fromstring(response.text)
        except ET.ParseError as exc:
            raise UpstreamFailed("arXiv returned an unreadable answer.") from exc
        entry = feed.find("a:entry", _ATOM)
        title = _text(entry, "a:title") if entry is not None else ""
        if entry is None or not title or _text(entry, "a:id").endswith("/api/errors"):
            raise PaperNotFound("arXiv does not know this id.")
        categories = [
            ARXIV_CATEGORIES.get(term, term)
            for term in (node.get("term", "") for node in entry.findall("a:category", _ATOM))
            if term
        ]
        return Paper(
            source="arxiv",
            identifier=arxiv_id,
            title=" ".join(title.split()),
            authors=[
                " ".join(name.split())
                for name in (_text(author, "a:name") for author in entry.findall("a:author", _ATOM))
                if name
            ],
            year=_text(entry, "a:published")[:4],
            keywords=list(dict.fromkeys(categories)),
            doi=_text(entry, "x:doi") or f"10.48550/arXiv.{_VERSION.sub('', arxiv_id)}",
            pdf_urls=[ARXIV_PDF + arxiv_id],
        )

    def _doi(self, client: httpx.Client, doi: str) -> Paper:
        data = self._get_json(client, CROSSREF_API + quote(doi, safe="/"), "Crossref")
        message = data.get("message")
        work: dict[str, object] = message if isinstance(message, dict) else {}
        titles = work.get("title")
        title = str(titles[0]) if isinstance(titles, list) and titles else ""
        if not title:
            raise PaperNotFound("Crossref has no title for this DOI.")
        authors: list[str] = []
        raw_authors = work.get("author")
        for author in raw_authors if isinstance(raw_authors, list) else []:
            if isinstance(author, dict):
                name = " ".join(
                    str(author[part]) for part in ("given", "family") if author.get(part)
                ) or str(author.get("name") or "")
                if name:
                    authors.append(name)
        subjects = work.get("subject")
        keywords = [str(s) for s in subjects] if isinstance(subjects, list) else []
        urls: list[str] = []
        links = work.get("link")
        for link in links if isinstance(links, list) else []:
            if isinstance(link, dict) and "pdf" in str(link.get("content-type", "")).lower():
                urls.append(str(link.get("URL", "")))
        urls.extend(self._unpaywall(client, doi))
        return Paper(
            source="doi",
            identifier=doi,
            title=" ".join(title.split()),
            authors=authors,
            year=_crossref_year(work),
            keywords=list(dict.fromkeys(keywords)),
            doi=doi,
            pdf_urls=list(dict.fromkeys(url for url in urls if url)),
        )

    def _unpaywall(self, client: httpx.Client, doi: str) -> list[str]:
        """Open-access copies; Unpaywall requires a contact email, so it is opt-in."""
        if not self._email:
            return []
        try:
            data = self._get_json(
                client,
                f"{UNPAYWALL_API}{quote(doi, safe='/')}?email={quote(self._email)}",
                "Unpaywall",
            )
        except (PaperNotFound, UpstreamFailed) as exc:
            logger.info("unpaywall lookup failed: %s", exc)
            return []
        urls: list[str] = []
        locations = data.get("oa_locations")
        best = data.get("best_oa_location")
        for location in [best, *(locations if isinstance(locations, list) else [])]:
            if isinstance(location, dict) and location.get("url_for_pdf"):
                urls.append(str(location["url_for_pdf"]))
        return urls

    def _fetch_pdf(self, client: httpx.Client, url: str, out: BinaryIO) -> bool:
        for _hop in range(MAX_REDIRECTS + 1):
            parts = urlsplit(url)
            host = parts.hostname
            if parts.scheme != "https" or not host:
                raise UpstreamFailed("refusing a non-https link")
            address = self._resolve(host)
            if address is None:
                raise UpstreamFailed("refusing a link to a non-public address")
            # Connect to the address that was just checked; TLS still verifies the host name.
            with client.stream(
                "GET",
                _pinned(url, host, address),
                headers={"Accept": "application/pdf", "Host": parts.netloc},
                extensions={"sni_hostname": host},
            ) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("location", ""))
                    continue
                if response.status_code != 200:
                    return False
                out.seek(0)
                out.truncate()
                head = b""
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_PDF_BYTES:
                        raise UpstreamFailed("the PDF is larger than the import limit")
                    if len(head) < len(PDF_MAGIC):
                        head = (head + chunk)[: len(PDF_MAGIC)]
                        if len(head) == len(PDF_MAGIC) and head != PDF_MAGIC:
                            return False
                    out.write(chunk)
                return head == PDF_MAGIC
        raise UpstreamFailed("too many redirects")


def _text(node: ET.Element | None, path: str) -> str:
    if node is None:
        return ""
    found = node.find(path, _ATOM)
    return (found.text or "").strip() if found is not None else ""


def _crossref_year(work: dict[str, object]) -> str:
    for name in ("published", "issued", "published-print", "published-online"):
        block = work.get(name)
        parts = block.get("date-parts") if isinstance(block, dict) else None
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            return str(parts[0][0])
    return ""
