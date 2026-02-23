from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from packages.contracts.models import DesktopAction


@dataclass(slots=True)
class ProviderInput:
    task: str
    step_index: int
    width: int
    height: int
    active_window: str | None
    ocr_text: list[str]
    candidate_text: list[str]
    image_base64: str
    last_result_message: str | None


@dataclass(slots=True)
class ProviderOutput:
    observation: str
    reasoning: str
    action: DesktopAction | dict
    confidence: float
    expected_outcome: str


class PlannerProvider(Protocol):
    def plan_next_action(self, payload: ProviderInput) -> ProviderOutput:
        ...
