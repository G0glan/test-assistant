from __future__ import annotations

from apps.executor.runner import run_session
from apps.executor.state import SessionRuntimeState
from packages.contracts.models import Constraints, TurnResponse
from tests.fixtures.sample_data import SAMPLE_PNG_BASE64


class FakeClient:
    def __init__(self, responses: list[dict]) -> None:
        self._responses = responses
        self._idx = 0

    def turn(self, _req):
        payload = self._responses[min(self._idx, len(self._responses) - 1)]
        self._idx += 1
        return TurnResponse.model_validate(payload)


def _mock_capture():
    class Screen:
        image_base64 = SAMPLE_PNG_BASE64
        width = 1920
        height = 1080

    return Screen()


def test_retry_then_fail_when_wait_repeats(monkeypatch) -> None:
    monkeypatch.setattr("apps.executor.runner.capture_screen", _mock_capture)
    responses = [
        {
            "observation": "none",
            "reasoning": "retry",
            "action": {"action": "wait", "parameters": {"seconds": 0.1}},
            "risk": "low",
            "confidence": 0.5,
            "expected_outcome": "retry",
            "trace_id": "t1",
        },
        {
            "observation": "none",
            "reasoning": "retry",
            "action": {"action": "wait", "parameters": {"seconds": 0.1}},
            "risk": "low",
            "confidence": 0.5,
            "expected_outcome": "retry",
            "trace_id": "t2",
        },
    ]
    client = FakeClient(responses)
    state = SessionRuntimeState(session_id="sess1", task="do thing")
    new_state = run_session(client=client, state=state, constraints=Constraints(max_steps=10), dry_run=True, max_retries=1)
    assert new_state.last_result is not None
    assert "No state change" in new_state.last_result["message"]


def test_confirmation_path_pauses(monkeypatch) -> None:
    monkeypatch.setattr("apps.executor.runner.capture_screen", _mock_capture)
    responses = [
        {
            "observation": "danger",
            "reasoning": "delete file",
            "action": {"action": "click", "parameters": {"x": 10, "y": 10}},
            "risk": "destructive",
            "confidence": 0.9,
            "expected_outcome": "deleted",
            "confirmation_required": True,
            "confirmation_id": "c1",
            "trace_id": "t1",
        }
    ]
    client = FakeClient(responses)
    state = SessionRuntimeState(session_id="sess2", task="delete file")
    new_state = run_session(client=client, state=state, constraints=Constraints(max_steps=10), dry_run=True)
    assert new_state.pending_confirmation_id == "c1"
