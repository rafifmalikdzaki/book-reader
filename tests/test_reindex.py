"""Content-addressed reindexing keeps saved state attached across renames."""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from book_reader.app import create_app
from book_reader.reading.sections import SectionIndex
from book_reader.services import Services, build_services


def _services(library: Path, tmp_path: Path) -> Services:
    services = build_services(library, tmp_path / "state")
    first = services.reconciler.sync()
    assert first.count == 0
    return services


def _page(services: Services, rel: str) -> object:
    entry = services.progress.get(rel)
    assert entry is not None
    return entry["page"]


def _note(services: Services, rel: str) -> None:
    services.notepad.add_note(
        group="inbox",
        book=rel,
        kind="pdf",
        quote="hello-search-needle",
        page=1,
        section="Intro",
    )


def test_rename_moves_progress_note_and_page_count(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    source = library / "sub" / "a.pdf"
    services.progress.update("sub/a.pdf", page=2)
    _note(services, "sub/a.pdf")
    session = services.chats.create_session(book="sub/a.pdf")
    services.chats.add_message(
        session["id"],
        "assistant",
        "quote",
        sources=[{"book": "sub/a.pdf", "page": 1}],
    )
    assert services.pages.count("sub/a.pdf", source) == 3

    (library / "shelf").mkdir()
    target = library / "shelf" / "a-renamed.pdf"
    source.rename(target)

    report = services.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "shelf/a-renamed.pdf"}
    assert _page(services, "shelf/a-renamed.pdf") == 2
    assert services.progress.get("sub/a.pdf") is None
    assert services.notepad.notes(book="shelf/a-renamed.pdf")[0]["quote"] == "hello-search-needle"
    assert services.pages.count("shelf/a-renamed.pdf", target) == 3
    chat = services.chats.get_session(session["id"])
    assert chat is not None
    assert chat["book"] == "shelf/a-renamed.pdf"
    assert chat["messages"][0]["sources"][0]["book"] == "shelf/a-renamed.pdf"
    assert services.reconciler.resolve("sub/a.pdf") == "shelf/a-renamed.pdf"
    assert report.backed_up is not None
    assert (Path(report.backed_up) / "progress.json").is_file()
    assert (Path(report.backed_up) / "chats.json").is_file()

    pages = json.loads((tmp_path / "state" / "pages.json").read_text())
    assert "sub/a.pdf" not in pages["books"]


def test_markdown_move_follows_scroll_and_note(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    services.progress.update("note.md", scroll=0.42)
    services.notepad.add_note(
        group="inbox",
        book="note.md",
        kind="md",
        quote="snake_case",
        line_start=9,
        line_end=9,
    )
    (library / "shelf").mkdir()
    (library / "note.md").rename(library / "shelf" / "renamed.md")

    report = services.reconciler.sync()

    assert report.moved == {"note.md": "shelf/renamed.md"}
    entry = services.progress.get("shelf/renamed.md")
    assert entry is not None
    assert entry["scroll"] == 0.42
    note = services.notepad.notes(book="shelf/renamed.md")[0]
    assert note["line_start"] == 9


def test_copy_delete_is_matched_by_content_not_name(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=3)
    (library / "elsewhere").mkdir()
    copied = library / "elsewhere" / "totally-different.pdf"
    shutil.copy2(library / "sub" / "a.pdf", copied)
    (library / "sub" / "a.pdf").unlink()

    report = services.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "elsewhere/totally-different.pdf"}
    assert _page(services, "elsewhere/totally-different.pdf") == 3


def test_copy_does_not_steal_state_from_a_present_book(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    (library / "copy").mkdir()
    shutil.copy2(library / "sub" / "a.pdf", library / "copy" / "a.pdf")

    report = services.reconciler.sync()

    assert report.moved == {}
    assert _page(services, "sub/a.pdf") == 2
    assert services.progress.get("copy/a.pdf") is None


def test_ambiguous_duplicates_are_left_alone(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    twin = library / "sub" / "twin.pdf"
    shutil.copy2(library / "sub" / "a.pdf", twin)
    services.reconciler.sync()  # record the twin in the manifest

    (library / "out-one").mkdir()
    (library / "out-two").mkdir()
    shutil.copy2(library / "sub" / "a.pdf", library / "out-one" / "one.pdf")
    shutil.copy2(twin, library / "out-two" / "two.pdf")
    (library / "sub" / "a.pdf").unlink()
    twin.unlink()

    report = services.reconciler.sync()

    assert report.moved == {}
    assert _page(services, "sub/a.pdf") == 2
    assert services.progress.get("out-one/one.pdf") is None


def test_manifest_remembers_missing_content(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    saved = (library / "sub" / "a.pdf").read_bytes()
    (library / "sub" / "a.pdf").unlink()
    services.reconciler.sync()

    (library / "returned").mkdir()
    restored = library / "returned" / "restored.pdf"
    restored.write_bytes(saved)

    report = services.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "returned/restored.pdf"}
    assert _page(services, "returned/restored.pdf") == 2


def test_manifest_is_not_rewritten_when_nothing_changes(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    manifest = tmp_path / "state" / "library_manifest.json"
    before = manifest.read_bytes()

    services.reconciler.sync()

    assert manifest.read_bytes() == before


def test_section_cache_remap(tmp_path: Path) -> None:
    index = SectionIndex(tmp_path)
    index.path.write_text(
        json.dumps(
            {
                "version": 1,
                "books": {
                    "old.pdf": {
                        "mtime": 1.0,
                        "size": 10,
                        "sections": [{"title": "One", "start_page": 1, "end_page": 2, "depth": 0}],
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    assert index.remap({"old.pdf": "new.pdf"}) == set()

    books = json.loads(index.path.read_text())["books"]
    assert "old.pdf" not in books
    assert books["new.pdf"]["sections"][0]["title"] == "One"


def test_old_book_url_redirects_and_library_announces_move(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    app = create_app(library, state)
    with TestClient(app) as client:
        (library / "shelf").mkdir()
        (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")
        response = client.get("/book/sub/a.pdf", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"].endswith("/book/shelf/moved.pdf")

        library_payload = client.get("/api/library").json()
        assert "1 book kept their notes and place" in library_payload["relocation_notice"]
        assert "shelf/moved.pdf" in {book["rel"] for book in library_payload["books"]}


def test_second_rename_after_restart_keeps_following_content(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "first.pdf")
    assert services.reconciler.sync().moved == {"sub/a.pdf": "shelf/first.pdf"}

    # A new process re-reads the manifest from disk, then the user renames again.
    restarted = build_services(library, state)
    restarted.reconciler.sync()
    (library / "shelf" / "first.pdf").rename(library / "shelf" / "second.pdf")
    report = restarted.reconciler.sync()

    assert report.moved == {"shelf/first.pdf": "shelf/second.pdf"}
    assert _page(restarted, "shelf/second.pdf") == 2
    assert restarted.reconciler.resolve("sub/a.pdf") == "shelf/second.pdf"
    assert restarted.reconciler.resolve("shelf/first.pdf") == "shelf/second.pdf"


def test_swapping_two_names_swaps_their_state_by_content(library: Path, tmp_path: Path) -> None:
    other = library / "sub" / "b.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "the other book")
    doc.save(other)
    doc.close()
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    services.progress.update("sub/b.pdf", page=1)
    services.notepad.add_note(
        group="inbox", book="sub/a.pdf", kind="pdf", quote="hello-search-needle", page=1
    )
    services.notepad.add_note(
        group="inbox", book="sub/b.pdf", kind="pdf", quote="the other book", page=1
    )

    temporary = library / "sub" / "swap.pdf"
    (library / "sub" / "a.pdf").rename(temporary)
    (library / "sub" / "b.pdf").rename(library / "sub" / "a.pdf")
    temporary.rename(library / "sub" / "b.pdf")

    report = services.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "sub/b.pdf", "sub/b.pdf": "sub/a.pdf"}
    assert _page(services, "sub/a.pdf") == 1
    assert _page(services, "sub/b.pdf") == 2
    assert services.pages.count("sub/a.pdf", library / "sub" / "a.pdf") == 1
    assert services.pages.count("sub/b.pdf", library / "sub" / "b.pdf") == 3
    assert [n["book"] for n in services.notepad.notes(book="sub/a.pdf")] == ["sub/a.pdf"]
    assert services.notepad.notes(book="sub/a.pdf")[0]["quote"] == "the other book"
    assert services.notepad.notes(book="sub/b.pdf")[0]["quote"] == "hello-search-needle"


def test_failed_state_write_stays_retryable_after_restart(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")

    def refuse(_books: dict[str, object]) -> bool:
        return False

    monkeypatch.setattr(services.progress, "_write", refuse)
    failed = services.reconciler.sync()

    assert failed.moved == {"sub/a.pdf": "shelf/moved.pdf"}
    assert failed.failed == ["progress"]
    assert _page(services, "sub/a.pdf") == 2
    assert services.progress.get("shelf/moved.pdf") is None
    assert services.reconciler.resolve("sub/a.pdf") == "sub/a.pdf"
    assert not (state / "last_reindex.json").exists()

    restarted = build_services(library, state)
    report = restarted.reconciler.sync()

    assert report.failed == []
    assert report.moved == {"sub/a.pdf": "shelf/moved.pdf"}
    assert _page(restarted, "shelf/moved.pdf") == 2
    assert restarted.progress.get("sub/a.pdf") is None
    assert restarted.reconciler.resolve("sub/a.pdf") == "shelf/moved.pdf"


def test_failed_swap_rolls_back_every_store_before_retry(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = library / "sub" / "b.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "beta")
    doc.save(other)
    doc.close()
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    services.progress.update("sub/b.pdf", page=1)
    services.notepad.add_note(group="inbox", book="sub/a.pdf", kind="pdf", quote="alpha", page=1)
    services.notepad.add_note(group="inbox", book="sub/b.pdf", kind="pdf", quote="beta", page=1)
    services.pages.count("sub/a.pdf", library / "sub" / "a.pdf")
    services.pages.count("sub/b.pdf", other)

    temporary = library / "sub" / "swap.pdf"
    (library / "sub" / "a.pdf").rename(temporary)
    (library / "sub" / "b.pdf").rename(library / "sub" / "a.pdf")
    temporary.rename(library / "sub" / "b.pdf")

    def refuse(_books: dict[str, object]) -> bool:
        return False

    monkeypatch.setattr(services.progress, "_write", refuse)
    failed = services.reconciler.sync()

    assert failed.moved == {"sub/a.pdf": "sub/b.pdf", "sub/b.pdf": "sub/a.pdf"}
    assert failed.failed == ["progress"]
    # Every store is back on the pre-swap content: notes and page counts too.
    assert _page(services, "sub/a.pdf") == 2
    assert _page(services, "sub/b.pdf") == 1
    assert services.notepad.notes(book="sub/a.pdf")[0]["quote"] == "alpha"
    assert services.notepad.notes(book="sub/b.pdf")[0]["quote"] == "beta"
    assert services.reconciler.resolve("sub/a.pdf") == "sub/a.pdf"

    monkeypatch.undo()
    restarted = build_services(library, state)
    report = restarted.reconciler.sync()

    assert report.failed == []
    assert _page(restarted, "sub/a.pdf") == 1
    assert _page(restarted, "sub/b.pdf") == 2
    assert restarted.notepad.notes(book="sub/a.pdf")[0]["quote"] == "beta"
    assert restarted.notepad.notes(book="sub/b.pdf")[0]["quote"] == "alpha"
    assert restarted.pages.count("sub/a.pdf", library / "sub" / "a.pdf") == 1
    assert restarted.pages.count("sub/b.pdf", library / "sub" / "b.pdf") == 3


def test_manifest_write_failure_rolls_back_swap(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = library / "sub" / "b.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "beta")
    doc.save(other)
    doc.close()
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    services.progress.update("sub/b.pdf", page=1)

    temporary = library / "sub" / "swap.pdf"
    (library / "sub" / "a.pdf").rename(temporary)
    (library / "sub" / "b.pdf").rename(library / "sub" / "a.pdf")
    temporary.rename(library / "sub" / "b.pdf")

    def refuse_manifest(_books: dict[str, object]) -> bool:
        return False

    monkeypatch.setattr(services.reconciler, "_save_manifest", refuse_manifest)
    failed = services.reconciler.sync()

    assert failed.failed == ["manifest"]
    assert _page(services, "sub/a.pdf") == 2
    assert _page(services, "sub/b.pdf") == 1
    assert not (state / "reindex_transaction.json").exists()

    monkeypatch.undo()
    restarted = build_services(library, state)
    report = restarted.reconciler.sync()
    assert report.failed == []
    assert _page(restarted, "sub/a.pdf") == 1
    assert _page(restarted, "sub/b.pdf") == 2


def test_interrupted_swap_recovers_from_transaction_on_restart(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = library / "sub" / "b.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "beta")
    doc.save(other)
    doc.close()
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    services.progress.update("sub/b.pdf", page=1)

    temporary = library / "sub" / "swap.pdf"
    (library / "sub" / "a.pdf").rename(temporary)
    (library / "sub" / "b.pdf").rename(library / "sub" / "a.pdf")
    temporary.rename(library / "sub" / "b.pdf")

    def crash(_books: dict[str, object]) -> bool:
        raise RuntimeError("simulated crash after the stores were migrated")

    monkeypatch.setattr(services.reconciler, "_save_manifest", crash)
    with pytest.raises(RuntimeError):
        services.reconciler.sync()
    assert (state / "reindex_transaction.json").is_file()

    monkeypatch.undo()
    restarted = build_services(library, state)
    report = restarted.reconciler.sync()

    assert report.recovered is True
    assert report.failed == []
    assert _page(restarted, "sub/a.pdf") == 1
    assert _page(restarted, "sub/b.pdf") == 2
    assert not (state / "reindex_transaction.json").exists()


def test_concurrent_note_write_survives_forced_rollback(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")

    started = threading.Event()
    proceed = threading.Event()

    def blocked_failure(_books: dict[str, object]) -> bool:
        started.set()
        proceed.wait(3)
        return False

    monkeypatch.setattr(services.progress, "_write", blocked_failure)
    written: list[str] = []
    failures: list[BaseException] = []

    def write_note() -> None:
        try:
            started.wait(3)
            services.notepad.add_note(
                group="inbox",
                book="shelf/moved.pdf",
                kind="pdf",
                quote="written while reindex was running",
                page=1,
            )
            written.append("ok")
        except BaseException as exc:  # pragma: no cover - diagnostic
            failures.append(exc)

    writer = threading.Thread(target=write_note)
    writer.start()
    report = services.reconciler.sync()
    proceed.set()
    writer.join(5)

    assert report.failed == ["progress"]
    assert failures == []
    assert written == ["ok"]
    quotes = [note["quote"] for note in services.notepad.notes()]
    assert "written while reindex was running" in quotes


def test_copy_survives_source_deletion_after_restart(library: Path, tmp_path: Path) -> None:
    state = tmp_path / "state"
    services = build_services(library, state)
    services.reconciler.sync()
    services.progress.update("sub/a.pdf", page=2)
    services.notepad.add_note(group="inbox", book="sub/a.pdf", kind="pdf", quote="alpha", page=1)
    (library / "backup").mkdir()
    copy = library / "backup" / "a-copy.pdf"
    shutil.copy2(library / "sub" / "a.pdf", copy)

    first = services.reconciler.sync()
    assert first.moved == {}

    (library / "sub" / "a.pdf").unlink()
    restarted = build_services(library, state)
    report = restarted.reconciler.sync()

    assert report.moved == {"sub/a.pdf": "backup/a-copy.pdf"}
    assert _page(restarted, "backup/a-copy.pdf") == 2
    assert restarted.notepad.notes(book="backup/a-copy.pdf")[0]["quote"] == "alpha"


def test_backup_failure_blocks_migration(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    services = _services(library, tmp_path)
    services.progress.update("sub/a.pdf", page=2)
    (library / "shelf").mkdir()
    (library / "sub" / "a.pdf").rename(library / "shelf" / "moved.pdf")

    def broken_copy(*_args: object, **_kwargs: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(shutil, "copy2", broken_copy)
    report = services.reconciler.sync()

    assert report.failed == ["backup"]
    assert _page(services, "sub/a.pdf") == 2
    assert services.reconciler.resolve("sub/a.pdf") == "sub/a.pdf"
    assert not (tmp_path / "state" / "reindex_transaction.json").exists()


def test_deleted_path_becomes_a_tombstone(library: Path, tmp_path: Path) -> None:
    services = _services(library, tmp_path)
    (library / "note.md").unlink()

    services.reconciler.sync()

    manifest = json.loads((tmp_path / "state" / "library_manifest.json").read_text())
    assert manifest["books"]["note.md"]["present"] is False
    assert len(manifest["books"]["note.md"]["hash"]) == 64
