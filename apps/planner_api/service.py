from __future__ import annotations

import logging

from fastapi import HTTPException

from apps.planner_api.logging_utils import TraceAdapter
from apps.planner_api.providers import PlannerProvider, ProviderInput
from apps.planner_api.session_store import SessionStore
from packages.contracts.models import (
    ConfirmRequest,
    ConfirmResponse,
    StartSessionRequest,
    StartSessionResponse,
    TurnRequest,
    TurnResponse,
)
from packages.contracts.normalization import normalize_action
from packages.contracts.utils import action_fingerprint, new_trace_id
from packages.perception import analyze_screen
from packages.policy.risk import classify_risk

logger = logging.getLogger("planner_api.service")


def _captcha_detected(ocr_text: list[str]) -> bool:
    joined = " ".join(ocr_text).lower()
    return "captcha" in joined or "i am not a robot" in joined


class PlannerService:
    def __init__(self, provider: PlannerProvider, session_store: SessionStore) -> None:
        self.provider = provider
        self.sessions = session_store

    def start_session(self, req: StartSessionRequest) -> StartSessionResponse:
        state = self.sessions.create(task=req.task, constraints=req.constraints)
        return StartSessionResponse(
            session_id=state.session_id,
            created_at=state.created_at,
            constraints=state.constraints,
        )

    def confirm(self, session_id: str, req: ConfirmRequest) -> ConfirmResponse:
        state = self.sessions.get(session_id)
        if not state:
            raise HTTPException(status_code=404, detail="session not found")

        approved = req.approved and self.sessions.approve_confirmation(session_id, req.confirmation_id)
        status = "approved" if approved else "not_found"
        if not req.approved:
            status = "rejected"
            state.pending_confirmations.pop(req.confirmation_id, None)
        return ConfirmResponse(session_id=session_id, confirmation_id=req.confirmation_id, status=status)

    def turn(self, req: TurnRequest) -> TurnResponse:
        trace_id = req.context.trace_id or new_trace_id()
        log = TraceAdapter(logger, {"trace_id": trace_id})
        session = self.sessions.get(req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="session not found")

        constraints = req.constraints or session.constraints
        if constraints.max_steps is not None and req.context.step_index >= constraints.max_steps:
            fail_action = {"action": "fail", "parameters": {"reason": "max_steps reached"}}
            normalized = normalize_action(fail_action, req.screen.width, req.screen.height)
            return TurnResponse(
                observation="Maximum steps reached.",
                reasoning="Safety guardrail triggered.",
                action=normalized,
                risk="low",
                confidence=1.0,
                expected_outcome="execution stops",
                trace_id=trace_id,
            )

        perception = analyze_screen(req.screen)
        ocr_text = [t.text for t in perception.tokens]
        if _captcha_detected(ocr_text):
            action = normalize_action(
                {"action": "fail", "parameters": {"reason": "CAPTCHA detected. User interaction required."}},
                req.screen.width,
                req.screen.height,
            )
            return TurnResponse(
                observation="CAPTCHA or anti-bot challenge detected.",
                reasoning="Policy blocks captcha solving or bypass attempts.",
                action=action,
                risk="destructive",
                confidence=0.98,
                expected_outcome="task stops safely",
                trace_id=trace_id,
            )

        payload = ProviderInput(
            task=req.task,
            step_index=req.context.step_index,
            width=req.screen.width,
            height=req.screen.height,
            active_window=req.context.active_window,
            ocr_text=ocr_text,
            candidate_text=[c.text for c in perception.candidates],
            image_base64=req.screen.image_base64,
            last_result_message=req.context.last_result.message if req.context.last_result else None,
        )

        try:
            result = self.provider.plan_next_action(payload)
        except Exception as exc:
            log.warning("provider failure: %s", exc)
            action = normalize_action({"action": "wait", "parameters": {"seconds": 1.0}}, req.screen.width, req.screen.height)
            return TurnResponse(
                observation="Planner provider timeout or error.",
                reasoning="Return a safe retry action for executor.",
                action=action,
                risk="low",
                confidence=0.2,
                expected_outcome="retry once after wait",
                trace_id=trace_id,
            )

        normalized_action = normalize_action(result.action, req.screen.width, req.screen.height)
        risk = classify_risk(normalized_action, req.task, result.observation, result.reasoning)
        fingerprint = action_fingerprint(normalized_action)
        confirmation_required = risk in {"sensitive", "destructive"} and not self.sessions.is_approved(
            req.session_id, fingerprint
        )
        confirmation_id = None
        if confirmation_required:
            confirmation_id = self.sessions.put_pending_confirmation(req.session_id, fingerprint)

        response = TurnResponse(
            observation=result.observation,
            reasoning=result.reasoning,
            action=normalized_action,
            risk=risk,
            confidence=result.confidence,
            expected_outcome=result.expected_outcome,
            confirmation_required=confirmation_required,
            confirmation_id=confirmation_id,
            trace_id=trace_id,
        )
        log.info("turn produced action=%s risk=%s", response.action.action, response.risk)
        return response
