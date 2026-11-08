"""Mistral autosort stores virtual categories keyed by content, never paths."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from book_reader.app import Services, build_services, create_app
from book_reader.organize import CategoryStore, LibraryOrganizer

TAXONOMY = [
    {"id": "papers", "name": "Papers", "description": "Peer-reviewed work"},
    {"id": "notes", "name": "Notes", "description": "Working notes"},
    {"id": "misc", "name": "Misc", "description": "Everything else"},
]


class FakeMistral:
    """Deterministic stand-in for MistralClient.json."""

    def __init__(self) -> None:
        self.taxonomy_calls = 0
        self.assignment_calls = 0

    def json(self, system: str, user: str) -> dict[str, object]:
        if system.startswith("Propose"):
            self.taxonomy_calls += 1
            return {"categories": TAXONOMY}
        self.assignment_calls += 1
        documents = json.loads(user)["documents"]
        return {
            "assignments": [
                {
                    "id": document["id"],
                    "category": "notes" if document["kind"] == "md" else "papers",
                    "confidence": 0.9,
                }
                for document in documents
            ]
        }


def _run_organizer(
    library: Path, tmp_path: Path
) -> tuple[Services, CategoryStore, FakeMistral, dict[str, object]]:
    services = build_services(library, tmp_path / "state")
    services.reconciler.sync()
    categories = CategoryStore(tmp_path / "state")
    fake = FakeMistral()
    organizer = LibraryOrganizer(
        services.library,
        services.pdf,
        services.sections,
        services.reconciler,
        categories,
        fake,
    )
    assert organizer.start() is True
    deadline = time.time() + 15
    status = organizer.status()
    while status["running"] and time.time() < deadline:
        time.sleep(0.01)
        status = organizer.status()
    assert not status["running"], status
    return services, categories, fake, status


def test_organizer_persists_taxonomy_and_hash_assignments_without_moving_files(
    library: Path, tmp_path: Path
) -> None:
    before = {
        path.relative_to(library).as_posix(): path.read_bytes()
        for path in library.rglob("*")
        if path.is_file()
    }
    services, categories, fake, status = _run_organizer(library, tmp_path)

    assert status["phase"] == "done", status
    assert status["error"] == ""
    assert status["available"] is True
    assert fake.taxonomy_calls == 1
    assert fake.assignment_calls >= 1

    stored = json.loads((tmp_path / "state" / "categories.json").read_text(encoding="utf-8"))
    assert [item["id"] for item in stored["taxonomy"]] == ["papers", "notes", "misc"]
    digests = {
        book.rel: services.reconciler.content_id(book.rel) for book in services.library.scan()
    }
    assert all(digests.values())
    assert set(stored["assignments"]) == set(digests.values())
    assert not any(digest.endswith((".pdf", ".md")) for digest in stored["assignments"])
    assert stored["assignments"][digests["sub/a.pdf"]]["category"] == "papers"
    assert stored["assignments"][digests["note.md"]]["category"] == "notes"

    digest = digests["sub/a.pdf"]
    assert digest is not None
    category = categories.category_for(digest)
    assert category is not None
    assert category["name"] == "Papers"

    after = {
        path.relative_to(library).as_posix(): path.read_bytes()
        for path in library.rglob("*")
        if path.is_file()
    }
    assert after == before


def test_category_survives_rename_and_reindex(library: Path, tmp_path: Path) -> None:
    services, _categories, _fake, _status = _run_organizer(library, tmp_path)
    digest = services.reconciler.content_id("sub/a.pdf")
    assert digest is not None

    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "renamed.pdf")
    report = services.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "shelf/renamed.pdf"}
    assert services.reconciler.content_id("shelf/renamed.pdf") == digest
    reloaded = CategoryStore(tmp_path / "state")
    category = reloaded.category_for(digest)
    assert category is not None
    assert category["id"] == "papers"

    stored = json.loads((tmp_path / "state" / "categories.json").read_text(encoding="utf-8"))
    assert digest in stored["assignments"]
    assert "sub/a.pdf" not in stored["assignments"]


def test_organizer_status_reports_progress_and_taxonomy(library: Path, tmp_path: Path) -> None:
    services, _categories, _fake, status = _run_organizer(library, tmp_path)
    assert {
        "running",
        "phase",
        "done",
        "total",
        "error",
        "available",
        "started",
        "taxonomy",
        "assignments",
    } <= set(status)
    total = len(services.library.scan())
    assert status["done"] == total
    assert status["total"] == total
    assert status["assignments"] == total
    taxonomy = status["taxonomy"]
    assert isinstance(taxonomy, list)
    assert [item["id"] for item in taxonomy] == ["papers", "notes", "misc"]


def test_organize_api_without_key(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    monkeypatch.delenv("MISTRAL_API", raising=False)
    with TestClient(create_app(library, tmp_path / "state")) as client:
        status = client.get("/api/organize/status")
        assert status.status_code == 200
        assert status.json() == {
            "available": False,
            "running": False,
            "reason": "Mistral is not configured",
        }
        response = client.post("/api/organize", json={"confirm": True})

    assert response.status_code == 503
    assert "Mistral" in response.json()["detail"]


def test_organize_api_requires_confirmation_when_configured(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    with TestClient(create_app(library, tmp_path / "state")) as client:
        status = client.get("/api/organize/status").json()
        assert status["available"] is True
        assert status["running"] is False
        assert status["phase"] == "idle"
        assert status["taxonomy"] == []
        assert status["assignments"] == 0
        assert {
            "running",
            "phase",
            "done",
            "total",
            "error",
            "available",
            "started",
        } <= set(status)
        response = client.post("/api/organize", json={"confirm": False})

    assert response.status_code == 400
    assert "confirm" in response.json()["detail"]
