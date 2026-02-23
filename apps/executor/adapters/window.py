from __future__ import annotations

import ctypes
from ctypes import wintypes


def get_active_window_info() -> str | None:
    """Best-effort active window title and pid on Windows."""
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None

    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return None

    buff = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buff, length + 1)
    title = buff.value.strip()
    if not title:
        return None

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return f"{title} (pid={pid.value})"
