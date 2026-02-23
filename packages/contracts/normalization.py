from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from .models import (
    DesktopAction,
    DragAction,
    HotkeyAction,
    MoveAction,
    SUPPORTED_ACTIONS,
    ScrollAction,
    TypeAction,
)

HOTKEY_ALLOWED = {
    "ctrl",
    "alt",
    "shift",
    "win",
    "cmd",
    "tab",
    "enter",
    "esc",
    "space",
    "up",
    "down",
    "left",
    "right",
    "delete",
    "backspace",
    "a",
    "c",
    "v",
    "x",
    "s",
    "n",
    "w",
    "f",
    "t",
    "r",
    "p",
    "z",
    "y",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
}


def _clamp_coord(value: int, max_value: int) -> int:
    return max(0, min(value, max_value))


def normalize_action(action_data: DesktopAction | dict[str, Any], width: int, height: int) -> DesktopAction:
    adapter = TypeAdapter(DesktopAction)
    action = adapter.validate_python(action_data)

    if action.action not in SUPPORTED_ACTIONS:
        raise ValueError(f"unsupported action for v1: {action.action}")

    max_x = max(0, width - 1)
    max_y = max(0, height - 1)

    if hasattr(action.parameters, "x"):
        action.parameters.x = _clamp_coord(int(action.parameters.x), max_x)
    if hasattr(action.parameters, "y"):
        action.parameters.y = _clamp_coord(int(action.parameters.y), max_y)

    if isinstance(action, MoveAction):
        action.parameters.x = _clamp_coord(action.parameters.x, max_x)
        action.parameters.y = _clamp_coord(action.parameters.y, max_y)

    if isinstance(action, DragAction):
        fx, fy = action.parameters.from_
        tx, ty = action.parameters.to
        action.parameters.from_ = (_clamp_coord(int(fx), max_x), _clamp_coord(int(fy), max_y))
        action.parameters.to = (_clamp_coord(int(tx), max_x), _clamp_coord(int(ty), max_y))

    if isinstance(action, HotkeyAction):
        normalized = [key.lower().strip() for key in action.parameters.keys]
        if any(key not in HOTKEY_ALLOWED for key in normalized):
            invalid = [key for key in normalized if key not in HOTKEY_ALLOWED]
            raise ValueError(f"invalid hotkey key(s): {invalid}")
        action.parameters.keys = normalized

    if isinstance(action, ScrollAction):
        action.parameters.amount = max(1, min(2000, int(action.parameters.amount)))

    if isinstance(action, TypeAction):
        action.parameters.text = action.parameters.text[:10_000]

    return action
