from __future__ import annotations

import os

import httpx

from packages.contracts.models import DesktopAction

from .base import PlannerProvider, ProviderInput, ProviderOutput


class CloudVLMProvider(PlannerProvider):
    """Cloud provider adapter with deterministic fallback.

    If env var `DESKTOP_AGENT_VLM_URL` is not set, returns a deterministic local stub.
    """

    def __init__(self, timeout_seconds: float = 15.0) -> None:
        self._url = os.getenv("DESKTOP_AGENT_VLM_URL", "").strip()
        self._api_key = os.getenv("DESKTOP_AGENT_VLM_API_KEY", "").strip()
        self._timeout = timeout_seconds

    def _stub(self, payload: ProviderInput) -> ProviderOutput:
        if payload.step_index == 0:
            action: DesktopAction | dict = {"action": "screenshot", "parameters": {}}
            return ProviderOutput(
                observation="Initial screen captured; waiting for first interaction.",
                reasoning="Need another screenshot baseline before acting.",
                action=action,
                confidence=0.62,
                expected_outcome="fresh screenshot context",
            )
        if any("login" in t.lower() for t in payload.ocr_text):
            action = {"action": "fail", "parameters": {"reason": "Login required. User authentication needed."}}
            return ProviderOutput(
                observation="Login-related text detected.",
                reasoning="Cannot authenticate on behalf of user without explicit input.",
                action=action,
                confidence=0.91,
                expected_outcome="pause for user authentication",
            )
        action = {"action": "wait", "parameters": {"seconds": 1.0}}
        return ProviderOutput(
            observation="No deterministic UI target identified in stub mode.",
            reasoning="Retry after short wait.",
            action=action,
            confidence=0.4,
            expected_outcome="updated screen state",
        )

    def plan_next_action(self, payload: ProviderInput) -> ProviderOutput:
        if not self._url:
            return self._stub(payload)

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        request_payload = {
            "task": payload.task,
            "step_index": payload.step_index,
            "screen": {
                "image_base64": payload.image_base64,
                "width": payload.width,
                "height": payload.height,
            },
            "active_window": payload.active_window,
            "ocr_text": payload.ocr_text[:200],
            "candidates": payload.candidate_text[:200],
            "last_result_message": payload.last_result_message,
            "requirements": {
                "single_action_only": True,
                "unsupported_actions": ["speak"],
            },
        }
        with httpx.Client(timeout=self._timeout) as client:
            response = client.post(self._url, json=request_payload, headers=headers)
            response.raise_for_status()
            body = response.json()

        return ProviderOutput(
            observation=body["observation"],
            reasoning=body["reasoning"],
            action=body["action"],
            confidence=float(body.get("confidence", 0.5)),
            expected_outcome=body.get("expected_outcome", "state change"),
        )
