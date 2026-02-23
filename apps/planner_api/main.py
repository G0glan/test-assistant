from __future__ import annotations

from fastapi import FastAPI

from apps.planner_api.logging_utils import configure_logging
from apps.planner_api.providers import CloudVLMProvider, PlannerProvider
from apps.planner_api.service import PlannerService
from apps.planner_api.session_store import SessionStore
from packages.contracts.models import (
    ConfirmRequest,
    ConfirmResponse,
    StartSessionRequest,
    StartSessionResponse,
    TurnRequest,
    TurnResponse,
)

configure_logging()

def create_app(provider: PlannerProvider | None = None, session_store: SessionStore | None = None) -> FastAPI:
    app = FastAPI(title="Desktop Agent Planner API", version="0.1.0")
    service = PlannerService(provider=provider or CloudVLMProvider(), session_store=session_store or SessionStore())

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/session/start", response_model=StartSessionResponse)
    def start_session(req: StartSessionRequest) -> StartSessionResponse:
        return service.start_session(req)

    @app.post("/v1/session/{session_id}/confirm", response_model=ConfirmResponse)
    def confirm_action(session_id: str, req: ConfirmRequest) -> ConfirmResponse:
        return service.confirm(session_id, req)

    @app.post("/v1/turn", response_model=TurnResponse)
    def turn(req: TurnRequest) -> TurnResponse:
        return service.turn(req)

    return app


app = create_app()
