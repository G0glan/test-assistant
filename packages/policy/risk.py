from __future__ import annotations

from packages.contracts.models import DesktopAction, RiskLevel

DESTRUCTIVE_TERMS = {
    "delete",
    "remove",
    "wipe",
    "format",
    "uninstall",
    "drop database",
    "reset",
}
SENSITIVE_TERMS = {
    "password",
    "otp",
    "api key",
    "token",
    "secret",
    "credential",
    "system settings",
}


def _contains_any(text: str, terms: set[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def classify_risk(
    action: DesktopAction,
    task: str,
    observation: str = "",
    reasoning: str = "",
) -> RiskLevel:
    joined = " ".join([task, observation, reasoning]).lower()
    if _contains_any(joined, DESTRUCTIVE_TERMS):
        return "destructive"
    if _contains_any(joined, SENSITIVE_TERMS):
        return "sensitive"
    if action.action in {"hotkey"} and "delete" in getattr(action.parameters, "keys", []):
        return "destructive"
    if action.action == "type":
        text = action.parameters.text.lower()
        if _contains_any(text, SENSITIVE_TERMS):
            return "sensitive"
    return "low"
