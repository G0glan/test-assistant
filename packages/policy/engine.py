from __future__ import annotations

from dataclasses import dataclass

from packages.contracts.models import Constraints, DesktopAction, RiskLevel
from packages.policy.risk import classify_risk

BLOCK_TERMS = {"captcha", "bypass", "anti-bot", "unauthorized access"}
CONFIRM_TERMS = {"delete", "overwrite", "system settings", "registry", "credentials"}


@dataclass(slots=True)
class PolicyDecision:
    status: str
    reason: str
    risk: RiskLevel


def _contains_any(text: str, terms: set[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def evaluate_executor_policy(
    action: DesktopAction,
    task: str,
    observation: str,
    reasoning: str,
    active_window: str | None,
    constraints: Constraints | None,
) -> PolicyDecision:
    joined = f"{task} {observation} {reasoning}"
    risk = classify_risk(action, task, observation, reasoning)

    if _contains_any(joined, BLOCK_TERMS):
        return PolicyDecision(status="block", reason="security or anti-bot content detected", risk="destructive")

    if constraints and constraints.blocked_apps and active_window:
        win = active_window.lower()
        if any(blocked.lower() in win for blocked in constraints.blocked_apps):
            return PolicyDecision(status="block", reason=f"active window blocked by policy: {active_window}", risk="sensitive")

    if risk in {"sensitive", "destructive"}:
        return PolicyDecision(status="confirm", reason=f"risk level is {risk}", risk=risk)

    if _contains_any(joined, CONFIRM_TERMS):
        return PolicyDecision(status="confirm", reason="potentially destructive context", risk="sensitive")

    return PolicyDecision(status="allow", reason="low risk action", risk="low")
