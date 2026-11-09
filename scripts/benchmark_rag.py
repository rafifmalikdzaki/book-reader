"""Retrieval benchmark: PageIndex hybrid vs local page scan vs Elasticsearch.

Usage:
    uv run python scripts/benchmark_rag.py --library ~/Documents/Books
    uv run python scripts/benchmark_rag.py --library ~/Documents/Books \
        --book 1-s2.0-S0952197622006121-main.pdf --es-url http://127.0.0.1:9200
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from collections.abc import Callable
from pathlib import Path

from book_reader.library.scan import Library
from book_reader.pdf import PdfCache
from book_reader.search import ElasticSearch, SearchHit
from book_reader.sections import SectionIndex

# (question, gold page, gold section keyword)
GOLDEN: dict[str, list[tuple[str, int, str]]] = {
    "1-s2.0-S0952197622006121-main.pdf": [
        ("barnacles mating optimizer inspiration", 5, "Barnacles"),
        ("equilibrium optimizer control volume mass balance", 10, "Equilibrium Optimizer"),
        ("transient search optimization algorithm", 10, "Transient Search"),
        ("mayfly algorithm optimization", 8, "Mayfly"),
        ("metaheuristics developed in 2019", 4, "2019"),
        ("conclusion of the survey", 31, "Conclusion"),
        ("swarm evolution based algorithms", 5, "Swarm"),
        ("human social interaction based algorithms", 11, "Human Social"),
        ("math physics based algorithms", 9, "Math/Physics"),
        ("references", 34, "Reference"),
    ]
}


def evaluate(
    name: str,
    retrieve: Callable[[str], list[SearchHit]],
    golden: list[tuple[str, int, str]],
    *,
    tolerance: int = 1,
) -> dict[str, object]:
    hit1 = hit3 = hit5 = 0
    reciprocal_ranks: list[float] = []
    section_hits = 0
    latencies: list[float] = []
    for question, gold_page, gold_section in golden:
        start = time.perf_counter()
        try:
            hits = retrieve(question)
        except Exception as exc:
            print(f"  {name}: error on {question!r}: {exc}")
            hits = []
        latencies.append((time.perf_counter() - start) * 1000)
        pages = [hit["page"] for hit in hits if hit["page"] is not None]
        tolerant = [1 if abs(page - gold_page) <= tolerance else 0 for page in pages]
        strict = [1 if page == gold_page else 0 for page in pages]
        if any(tolerant[:1]):
            hit1 += 1
        if any(tolerant[:3]):
            hit3 += 1
        if any(tolerant[:5]):
            hit5 += 1
        rank = next((index + 1 for index, value in enumerate(strict) if value), None)
        reciprocal_ranks.append(1.0 / rank if rank else 0.0)
        keyword = gold_section.casefold()
        if any(
            keyword in str(hit["section"]).casefold() or keyword in str(hit["snippet"]).casefold()
            for hit in hits[:3]
        ):
            section_hits += 1
    total = len(golden)
    return {
        "backend": name,
        "hit@1": round(hit1 / total, 3),
        "hit@3": round(hit3 / total, 3),
        "hit@5": round(hit5 / total, 3),
        "mrr": round(statistics.mean(reciprocal_ranks), 3),
        "section@3": round(section_hits / total, 3),
        "p50_ms": round(statistics.median(latencies), 1),
        "questions": total,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark library retrieval backends")
    parser.add_argument("--library", default=str(Path.home() / "Documents" / "Books"))
    parser.add_argument(
        "--book", default="1-s2.0-S0952197622006121-main.pdf", help="PDF to evaluate"
    )
    parser.add_argument("--state-dir", default=str(Path.home() / ".local/state/book-reader"))
    parser.add_argument("--es-url", default="", help="Optional Elasticsearch URL")
    parser.add_argument("--es-index", default="book-reader")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    args = parser.parse_args()

    root = Path(args.library).expanduser()
    state = Path(args.state_dir).expanduser()
    golden = GOLDEN.get(args.book)
    if golden is None:
        raise SystemExit(f"no golden questions for {args.book}; add them to GOLDEN")

    library = Library(root)
    path = library.find_book(args.book)
    if path is None:
        raise SystemExit(f"book not found under {root}: {args.book}")
    pdf = PdfCache()
    sections = SectionIndex(state)

    from book_reader.search import PageIndexSearch

    tree = PageIndexSearch(library, sections, pdf)
    rows = [
        evaluate(
            "pageindex-hybrid", lambda q: tree.search(q, limit=args.limit, book=args.book), golden
        ),
        evaluate(
            "local-page-scan",
            lambda q: [
                {
                    "book": args.book,
                    "kind": "pdf",
                    "page": hit["page"],
                    "line": None,
                    "line_end": None,
                    "section": sections.section_for_page(args.book, path, int(str(hit["page"]))),
                    "snippet": str(hit["snippet"]),
                }
                for hit in pdf.search(path, q, args.limit)
            ],
            golden,
        ),
    ]
    if args.es_url:
        elastic = ElasticSearch(args.es_url, args.es_index, pdf, sections, state)
        if elastic.available():
            rows.append(
                evaluate(
                    "elasticsearch",
                    lambda q: elastic.search(q, limit=args.limit, book=args.book),
                    golden,
                )
            )
        else:
            print(f"Elasticsearch not reachable at {args.es_url}; skipped")

    if args.json:
        print(json.dumps({"book": args.book, "results": rows}, indent=2))
        return
    headers = ["backend", "hit@1", "hit@3", "hit@5", "mrr", "section@3", "p50_ms"]
    print(f"# Retrieval benchmark — {args.book} ({len(golden)} questions)")
    print()
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join(["---"] * len(headers)) + "|")
    for row in rows:
        print("| " + " | ".join(str(row[key]) for key in headers) + " |")


if __name__ == "__main__":
    main()
