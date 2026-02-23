from __future__ import annotations

import httpx

from packages.contracts.models import (
    ConfirmRequest,
    ConfirmResponse,
    StartSessionRequest,
    StartSessionResponse,
    TurnRequest,
    TurnResponse,
)


class PlannerApiClient:
    def __init__(self, base_url: str, timeout_seconds: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def start_session(self, req: StartSessionRequest) -> StartSessionResponse:
        with httpx.Client(timeout=self.timeout_seconds) as client:
            resp = client.post(f"{self.base_url}/v1/session/start", json=req.model_dump(mode="json"))
            resp.raise_for_status()
            return StartSessionResponse.model_validate(resp.json())

    def turn(self, req: TurnRequest) -> TurnResponse:
        with httpx.Client(timeout=self.timeout_seconds) as client:
            resp = client.post(f"{self.base_url}/v1/turn", json=req.model_dump(mode="json", by_alias=True))
            resp.raise_for_status()
            return TurnResponse.model_validate(resp.json())

    def confirm(self, session_id: str, req: ConfirmRequest) -> ConfirmResponse:
        with httpx.Client(timeout=self.timeout_seconds) as client:
            resp = client.post(
                f"{self.base_url}/v1/session/{session_id}/confirm",
                json=req.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return ConfirmResponse.model_validate(resp.json())
