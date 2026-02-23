from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from packages.contracts.models import DesktopAction
from packages.contracts.normalization import normalize_action


def test_rejects_unsupported_speak_action() -> None:
    adapter = TypeAdapter(DesktopAction)
    with pytest.raises(ValidationError):
        adapter.validate_python({"action": "speak", "parameters": {"message": "hello"}})


def test_coordinate_normalization_clamps_to_screen() -> None:
    action = normalize_action({"action": "click", "parameters": {"x": 10000, "y": -50}}, width=1920, height=1080)
    assert action.parameters.x == 1919
    assert action.parameters.y == 0


def test_hotkey_validation_rejects_unknown_key() -> None:
    with pytest.raises(ValueError):
        normalize_action({"action": "hotkey", "parameters": {"keys": ["ctrl", "weirdkey"]}}, width=100, height=100)
