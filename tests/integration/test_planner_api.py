from __future__ import annotations

from fastapi.testclient import TestClient

from apps.planner_api.main import create_app
from apps.planner_api.providers.base import PlannerProvider, ProviderInput, ProviderOutput
from apps.planner_api.session_store import SessionStore
from packages.perception.ocr import OCRToken
from packages.perception.pipeline import PerceptionSnapshot
from tests.fixtures.sample_data import SAMPLE_PNG_BASE64


class MockProvider(PlannerProvider):
    def plan_next_action(self, payload: ProviderInput) -> ProviderOutput:
        return ProviderOutput(
            observation="Mock observation",
            reasoning="Mock reasoning",
            action={"action": "click", "parameters": {"x": 100, "y": 200}},
            confidence=0.95,
            expected_outcome="clicked target",
        )


def _new_client() -> TestClient:
    app = create_app(provider=MockProvider(), session_store=SessionStore())
    return TestClient(app)


def test_turn_endpoint_returns_single_action() -> None:
    client = _new_client()
    start = client.post("/v1/session/start", json={"task": "open browser"})
    assert start.status_code == 200
    session_id = start.json()["session_id"]

    turn_payload = {
        "session_id": session_id,
        "task": "open browser",
        "screen": {"image_base64": SAMPLE_PNG_BASE64, "width": 1920, "height": 1080},
        "context": {"step_index": 0},
    }
    resp = client.post("/v1/turn", json=turn_payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"]["action"] == "click"
    assert body["action"]["action"] != "speak"


def test_confirmation_required_then_confirmed() -> None:
    client = _new_client()
    start = client.post("/v1/session/start", json={"task": "delete a file"})
    session_id = start.json()["session_id"]
    turn_payload = {
        "session_id": session_id,
        "task": "delete a file",
        "screen": {"image_base64": SAMPLE_PNG_BASE64, "width": 1920, "height": 1080},
        "context": {"step_index": 0},
    }

    first = client.post("/v1/turn", json=turn_payload).json()
    assert first["confirmation_required"] is True
    confirmation_id = first["confirmation_id"]
    assert confirmation_id

    confirm = client.post(
        f"/v1/session/{session_id}/confirm",
        json={"confirmation_id": confirmation_id, "approved": True},
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "approved"

    second = client.post("/v1/turn", json=turn_payload).json()
    assert second["confirmation_required"] is False


def test_captcha_detection_yields_fail(monkeypatch) -> None:
    client = _new_client()
    start = client.post("/v1/session/start", json={"task": "open website"})
    session_id = start.json()["session_id"]

    def fake_analyze(_screen):
        return PerceptionSnapshot(
            tokens=[OCRToken(text="CAPTCHA", bbox=(0, 0, 10, 10), confidence=0.99)],
            candidates=[],
        )

    monkeypatch.setattr("apps.planner_api.service.analyze_screen", fake_analyze)
    resp = client.post(
        "/v1/turn",
        json={
            "session_id": session_id,
            "task": "open website",
            "screen": {"image_base64": SAMPLE_PNG_BASE64, "width": 1920, "height": 1080},
            "context": {"step_index": 0},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"]["action"] == "fail"
