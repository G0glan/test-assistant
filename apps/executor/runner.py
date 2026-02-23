from __future__ import annotations

import logging
import time

from apps.executor.adapters import DesktopInputExecutor, capture_screen, get_active_window_info
from apps.executor.client import PlannerApiClient
from apps.executor.logging_utils import TraceAdapter
from apps.executor.state import SessionRuntimeState, save_session_state
from packages.contracts.models import ActionResult, Constraints, TurnContext, TurnRequest
from packages.contracts.utils import action_fingerprint, new_trace_id
from packages.policy import evaluate_executor_policy

logger = logging.getLogger("executor.runner")


def run_session(
    client: PlannerApiClient,
    state: SessionRuntimeState,
    constraints: Constraints,
    dry_run: bool = True,
    max_retries: int = 1,
) -> SessionRuntimeState:
    executor = DesktopInputExecutor(dry_run=dry_run)
    retries = 0

    while True:
        screen = capture_screen()
        active_window = get_active_window_info()
        trace_id = new_trace_id()
        log = TraceAdapter(logger, {"trace_id": trace_id})
        req = TurnRequest(
            session_id=state.session_id,
            task=state.task,
            screen={
                "image_base64": screen.image_base64,
                "width": screen.width,
                "height": screen.height,
            },
            context=TurnContext(
                step_index=state.step_index,
                last_action=state.last_action,
                last_result=state.last_result,
                active_window=active_window,
                trace_id=trace_id,
            ),
            constraints=constraints,
        )
        response = client.turn(req)
        action = response.action
        fingerprint = action_fingerprint(action)

        policy = evaluate_executor_policy(
            action=action,
            task=state.task,
            observation=response.observation,
            reasoning=response.reasoning,
            active_window=active_window,
            constraints=constraints,
        )

        if response.confirmation_required or policy.status == "confirm":
            state.pending_confirmation_id = response.confirmation_id
            state.last_result = ActionResult(
                status="confirmation_required",
                message=f"confirmation required: {response.confirmation_id}",
            ).model_dump(mode="json")
            save_session_state(state)
            log.info("confirmation required confirmation_id=%s", response.confirmation_id)
            return state

        if policy.status == "block":
            state.last_result = ActionResult(status="blocked", message=policy.reason).model_dump(mode="json")
            save_session_state(state)
            return state

        result_msg = executor.execute(action)
        state.last_action = action.model_dump(mode="json", by_alias=True)
        state.last_result = ActionResult(status="executed", message=result_msg).model_dump(mode="json")
        state.step_index += 1
        save_session_state(state)
        log.info("executed action=%s step=%s", action.action, state.step_index)

        if action.action == "done":
            return state
        if action.action == "fail":
            return state

        if action.action == "wait":
            time.sleep(min(2.0, action.parameters.seconds))

        if action.action == "screenshot":
            continue

        # Basic retry strategy if planner gives repeated no-progress wait actions.
        if action.action == "wait":
            retries += 1
            if retries > max_retries:
                state.last_result = ActionResult(
                    status="failed",
                    message="No state change after retry budget exhausted.",
                ).model_dump(mode="json")
                save_session_state(state)
                return state
        else:
            retries = 0

        # Guard against stale risky action with missing approval.
        if state.pending_confirmation_id and fingerprint not in state.approved_fingerprints:
            return state
