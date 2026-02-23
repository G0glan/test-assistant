from __future__ import annotations

from packages.contracts.normalization import normalize_action
from packages.policy.risk import classify_risk


def test_risk_classification_defaults_low() -> None:
    action = normalize_action({"action": "click", "parameters": {"x": 1, "y": 1}}, width=10, height=10)
    risk = classify_risk(action=action, task="open docs page", observation="", reasoning="")
    assert risk == "low"


def test_risk_classification_sensitive_for_credentials() -> None:
    action = normalize_action({"action": "type", "parameters": {"text": "my password is test"}}, width=10, height=10)
    risk = classify_risk(action=action, task="sign in", observation="", reasoning="")
    assert risk == "sensitive"
