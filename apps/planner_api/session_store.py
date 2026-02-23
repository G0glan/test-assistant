from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from packages.contracts.models import Constraints


@dataclass(slots=True)
class SessionState:
    session_id: str
    task: str
    constraints: Constraints
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))
    pending_confirmations: dict[str, str] = field(default_factory=dict)
    approved_fingerprints: set[str] = field(default_factory=set)
    metadata: dict[str, Any] = field(default_factory=dict)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def create(self, task: str, constraints: Constraints | None) -> SessionState:
        session_id = uuid4().hex
        state = SessionState(
            session_id=session_id,
            task=task,
            constraints=constraints or Constraints(),
        )
        self._sessions[session_id] = state
        return state

    def get(self, session_id: str) -> SessionState | None:
        return self._sessions.get(session_id)

    def put_pending_confirmation(self, session_id: str, fingerprint: str) -> str:
        session = self._sessions[session_id]
        confirmation_id = uuid4().hex
        session.pending_confirmations[confirmation_id] = fingerprint
        return confirmation_id

    def approve_confirmation(self, session_id: str, confirmation_id: str) -> bool:
        session = self._sessions[session_id]
        fingerprint = session.pending_confirmations.pop(confirmation_id, None)
        if not fingerprint:
            return False
        session.approved_fingerprints.add(fingerprint)
        return True

    def is_approved(self, session_id: str, fingerprint: str) -> bool:
        session = self._sessions[session_id]
        return fingerprint in session.approved_fingerprints
