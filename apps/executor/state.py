from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

STATE_FILE = Path(".executor_state.json")


@dataclass(slots=True)
class SessionRuntimeState:
    session_id: str
    task: str
    step_index: int = 0
    last_action: dict[str, Any] | None = None
    last_result: dict[str, Any] | None = None
    pending_confirmation_id: str | None = None
    approved_fingerprints: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["approved_fingerprints"] = sorted(self.approved_fingerprints)
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionRuntimeState":
        obj = cls(
            session_id=data["session_id"],
            task=data["task"],
            step_index=int(data.get("step_index", 0)),
            last_action=data.get("last_action"),
            last_result=data.get("last_result"),
            pending_confirmation_id=data.get("pending_confirmation_id"),
        )
        obj.approved_fingerprints = set(data.get("approved_fingerprints", []))
        return obj


def _read_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def _write_state(data: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def save_session_state(state: SessionRuntimeState) -> None:
    all_state = _read_state()
    all_state[state.session_id] = state.to_dict()
    _write_state(all_state)


def load_session_state(session_id: str) -> SessionRuntimeState | None:
    all_state = _read_state()
    raw = all_state.get(session_id)
    if not raw:
        return None
    return SessionRuntimeState.from_dict(raw)


def delete_session_state(session_id: str) -> bool:
    all_state = _read_state()
    if session_id not in all_state:
        return False
    del all_state[session_id]
    _write_state(all_state)
    return True
