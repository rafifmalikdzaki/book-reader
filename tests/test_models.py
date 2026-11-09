"""The model registry stays consistent with the provider config and the prompts."""

from __future__ import annotations

import pytest

from book_reader.chat import prompts
from book_reader.chat_providers import DEFAULT_PRIORITY
from book_reader.models import (
    DEFAULT_OPENUI_FORMAT,
    OPENUI_FORMATS,
    model_info,
    registered_models,
)


def test_every_default_priority_model_is_registered() -> None:
    registered = {info.id for info in registered_models()}
    assert set(DEFAULT_PRIORITY.split(",")) <= registered


def test_registry_entries_are_well_formed() -> None:
    for info in registered_models():
        assert info.openui_format in OPENUI_FORMATS, info.id
        assert info.reasoning_effort in (True, False, None), info.id
        assert info.label, info.id
        for fmt in info.eval:
            assert fmt in OPENUI_FORMATS, info.id


def test_a_model_is_only_asked_for_lang_when_its_eval_supports_it() -> None:
    for info in registered_models():
        if info.openui_format == "lang":
            valid, _, total = info.eval.get("lang", "0/0").partition("/")
            assert total.isdigit() and int(valid) == int(total), info.id


def test_unknown_models_get_defaults_and_a_readable_label() -> None:
    info = model_info("acme:cool-model-1")
    assert (info.label, info.reasoning_effort, info.openui_format) == (
        "cool-model-1",
        None,
        DEFAULT_OPENUI_FORMAT,
    )
    assert not info.known


def test_format_resolution_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOOK_READER_OPENUI_FORMAT", raising=False)
    assert prompts.openui_format() == DEFAULT_OPENUI_FORMAT
    assert prompts.openui_format("acme:unknown") == DEFAULT_OPENUI_FORMAT
    registered_lang = [i for i in registered_models() if i.openui_format == "lang"]
    for info in registered_lang:
        assert prompts.openui_format(info.id) == "lang"
    monkeypatch.setenv("BOOK_READER_OPENUI_FORMAT", "json")
    for info in registered_lang:
        assert prompts.openui_format(info.id) == "json"
