from __future__ import annotations

import argparse
import re
import uuid
from typing import Dict, Optional

from fastapi import FastAPI
from pydantic import BaseModel

try:
    from pywinauto import Desktop
    from pywinauto.base_wrapper import BaseWrapper
except Exception as exc:  # pragma: no cover
    Desktop = None
    BaseWrapper = object  # type: ignore[assignment]
    IMPORT_ERROR = str(exc)
else:
    IMPORT_ERROR = ""


class ApiResponse(BaseModel):
    ok: bool
    message: str = ""
    errorCode: Optional[str] = None
    data: Optional[dict] = None


class FindPayload(BaseModel):
    app: Optional[str] = None
    windowTitle: Optional[str] = None
    role: Optional[str] = None
    name: Optional[str] = None
    elementId: Optional[str] = None


class ActionPayload(FindPayload):
    text: Optional[str] = None


app = FastAPI(title="desktop-agent-uia-sidecar", version="0.1.0")
ELEMENT_CACHE: Dict[str, BaseWrapper] = {}


def _as_response(ok: bool, message: str, error_code: Optional[str] = None, data: Optional[dict] = None) -> ApiResponse:
    return ApiResponse(ok=ok, message=message, errorCode=error_code, data=data)


def _rect_to_dict(wrapper: BaseWrapper) -> dict:
    rect = wrapper.rectangle()
    return {"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom}


def _cache_element(wrapper: BaseWrapper) -> str:
    token = f"uia_{uuid.uuid4().hex[:16]}"
    ELEMENT_CACHE[token] = wrapper
    return token


def _serialize_element(wrapper: BaseWrapper, role: Optional[str], app: Optional[str], window_title: Optional[str]) -> dict:
    token = _cache_element(wrapper)
    return {
        "elementId": token,
        "name": wrapper.window_text(),
        "role": role,
        "app": app,
        "windowTitle": window_title,
        "boundingBox": _rect_to_dict(wrapper),
    }


def _safe_regex_fragment(raw: str) -> str:
    return re.escape(raw.strip())


def _find_window(root: Desktop, payload: FindPayload):
    windows = root.windows()
    if payload.windowTitle:
        title = payload.windowTitle.lower()
        windows = [w for w in windows if title in (w.window_text() or "").lower()]
    return windows[0] if windows else None


def _find_descendant(window, payload: FindPayload):
    role = payload.role
    name = payload.name

    criteria = {}
    if role:
        criteria["control_type"] = role
    if name:
        criteria["title_re"] = f".*{_safe_regex_fragment(name)}.*"

    if criteria:
        try:
            return window.child_window(**criteria).wrapper_object()
        except Exception:
            pass

    try:
        descendants = window.descendants(control_type=role) if role else window.descendants()
    except Exception:
        descendants = []

    if name:
        needle = name.lower().strip()
        for node in descendants:
            label = (node.window_text() or "").lower()
            if needle in label:
                return node
    if descendants:
        return descendants[0]
    return None


def resolve_element(payload: FindPayload):
    if Desktop is None:
        return None, _as_response(False, f"pywinauto unavailable: {IMPORT_ERROR}", "sidecar_import_error")

    if payload.elementId and payload.elementId in ELEMENT_CACHE:
        return ELEMENT_CACHE[payload.elementId], None

    root = Desktop(backend="uia")
    window = _find_window(root, payload)
    if not window:
        return None, _as_response(False, "Window not found", "target_not_found")

    if not payload.role and not payload.name:
        return window, None

    node = _find_descendant(window, payload)
    if not node:
        return None, _as_response(False, "Element not found", "target_not_found")
    return node, None


@app.get("/health", response_model=ApiResponse)
def health():
    if Desktop is None:
        return _as_response(False, f"pywinauto unavailable: {IMPORT_ERROR}", "sidecar_import_error")
    return _as_response(True, "ok", data={"status": "ok"})


@app.post("/find", response_model=ApiResponse)
def find(payload: FindPayload):
    wrapper, err = resolve_element(payload)
    if err:
        return err
    try:
        data = _serialize_element(wrapper, payload.role, payload.app, payload.windowTitle)
        return _as_response(True, "element found", data=data)
    except Exception as exc:
        return _as_response(False, f"find failed: {exc}", "uia_error")


@app.post("/act/click", response_model=ApiResponse)
def act_click(payload: ActionPayload):
    wrapper, err = resolve_element(payload)
    if err:
        return err
    try:
        wrapper.click_input()
        data = _serialize_element(wrapper, payload.role, payload.app, payload.windowTitle)
        return _as_response(True, "clicked", data=data)
    except Exception as exc:
        return _as_response(False, f"click failed: {exc}", "uia_error")


@app.post("/act/focus", response_model=ApiResponse)
def act_focus(payload: ActionPayload):
    wrapper, err = resolve_element(payload)
    if err:
        return err
    try:
        wrapper.set_focus()
        data = _serialize_element(wrapper, payload.role, payload.app, payload.windowTitle)
        return _as_response(True, "focused", data=data)
    except Exception as exc:
        return _as_response(False, f"focus failed: {exc}", "uia_error")


@app.post("/act/type", response_model=ApiResponse)
def act_type(payload: ActionPayload):
    wrapper, err = resolve_element(payload)
    if err:
        return err
    if not payload.text:
        return _as_response(False, "text is required", "invalid_payload")
    try:
        wrapper.set_focus()
        wrapper.type_keys(payload.text, with_spaces=True, set_foreground=True)
        data = _serialize_element(wrapper, payload.role, payload.app, payload.windowTitle)
        return _as_response(True, "typed", data=data)
    except Exception as exc:
        return _as_response(False, f"type failed: {exc}", "uia_error")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
