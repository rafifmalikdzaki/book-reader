"""Plain-text scorecard for eval results."""

from __future__ import annotations

from collections.abc import Sequence

from .suite import EvalResult


def format_scorecard(results: Sequence[EvalResult]) -> str:
    """Format a list of `EvalResult` items into an ASCII benchmark table."""
    lines = [
        "=" * 98,
        f"{'CASE':<24} {'MODE':<8} {'MODEL':<22} {'OPENUI':<8} "
        f"{'CITE':<6} {'PEDAGOGY':<9} {'OVERALL':<8} {'LATENCY'}",
        "-" * 98,
    ]
    for r in results:
        model_label = f"{r.provider}:{r.model}"[:21]
        lines.append(
            f"{r.case_id:<24} {r.mode:<8} {model_label:<22} "
            f"{r.openui_score:<8.2f} {r.citation_score:<6.2f} "
            f"{r.pedagogy_score:<9.2f} {r.overall_score:<8.2f} {r.latency_ms:>6.0f} ms"
        )
    lines.append("-" * 98)
    if results:
        avg_openui = sum(r.openui_score for r in results) / len(results)
        avg_cite = sum(r.citation_score for r in results) / len(results)
        avg_ped = sum(r.pedagogy_score for r in results) / len(results)
        avg_total = sum(r.overall_score for r in results) / len(results)
        avg_lat = sum(r.latency_ms for r in results) / len(results)
        lines.append(
            f"{'AVERAGE':<24} {'all':<8} {'-':<22} "
            f"{avg_openui:<8.2f} {avg_cite:<6.2f} "
            f"{avg_ped:<9.2f} {avg_total:<8.2f} {avg_lat:>6.0f} ms"
        )
    lines.append("=" * 98)
    return "\n".join(lines)
