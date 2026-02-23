from __future__ import annotations

from fastapi.testclient import TestClient

from apps.planner_api.main import create_app
from apps.planner_api.providers.base import PlannerProvider, ProviderInput
from apps.planner_api.session_store import SessionStore
from tests.fixtures.sample_data import SAMPLE_PNG_BASE64


class FailingProvider(PlannerProvider):
    def plan_next_action(self, payload: ProviderInput):
        _ = payload
        raise TimeoutError("provider timeout")


def test_provider_timeout_returns_safe_wait() -> None:
    app = create_app(provider=FailingProvider(), session_store=SessionStore())
    client = TestClient(app)
    start = client.post("/v1/session/start", json={"task": "open site"})
    session_id = start.json()["session_id"]

    resp = client.post(
        "/v1/turn",
        json={
            "session_id": session_id,
            "task": "open site",
            "screen": {"image_base64": SAMPLE_PNG_BASE64, "width": 100, "height": 100},
            "context": {"step_index": 0},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["action"]["action"] == "wait"
