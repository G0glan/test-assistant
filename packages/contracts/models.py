from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

SUPPORTED_ACTIONS = [
    "click",
    "double_click",
    "right_click",
    "type",
    "hotkey",
    "scroll",
    "move",
    "drag",
    "wait",
    "screenshot",
    "done",
    "fail",
]
UNSUPPORTED_ACTIONS = ["speak"]
RiskLevel = Literal["low", "sensitive", "destructive"]


class ClickParams(BaseModel):
    x: int
    y: int


class TypeParams(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


class HotkeyParams(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=6)


class ScrollParams(BaseModel):
    direction: Literal["up", "down"]
    amount: int = Field(ge=1, le=5000)


class MoveParams(BaseModel):
    x: int
    y: int


class DragParams(BaseModel):
    from_: tuple[int, int] = Field(alias="from")
    to: tuple[int, int]


class WaitParams(BaseModel):
    seconds: float = Field(ge=0, le=60)


class ScreenshotParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DoneParams(BaseModel):
    summary: str = Field(min_length=1, max_length=5000)


class FailParams(BaseModel):
    reason: str = Field(min_length=1, max_length=5000)


class ClickAction(BaseModel):
    action: Literal["click"]
    parameters: ClickParams


class DoubleClickAction(BaseModel):
    action: Literal["double_click"]
    parameters: ClickParams


class RightClickAction(BaseModel):
    action: Literal["right_click"]
    parameters: ClickParams


class TypeAction(BaseModel):
    action: Literal["type"]
    parameters: TypeParams


class HotkeyAction(BaseModel):
    action: Literal["hotkey"]
    parameters: HotkeyParams


class ScrollAction(BaseModel):
    action: Literal["scroll"]
    parameters: ScrollParams


class MoveAction(BaseModel):
    action: Literal["move"]
    parameters: MoveParams


class DragAction(BaseModel):
    action: Literal["drag"]
    parameters: DragParams


class WaitAction(BaseModel):
    action: Literal["wait"]
    parameters: WaitParams


class ScreenshotAction(BaseModel):
    action: Literal["screenshot"]
    parameters: ScreenshotParams = Field(default_factory=ScreenshotParams)


class DoneAction(BaseModel):
    action: Literal["done"]
    parameters: DoneParams


class FailAction(BaseModel):
    action: Literal["fail"]
    parameters: FailParams


DesktopAction = Annotated[
    Union[
        ClickAction,
        DoubleClickAction,
        RightClickAction,
        TypeAction,
        HotkeyAction,
        ScrollAction,
        MoveAction,
        DragAction,
        WaitAction,
        ScreenshotAction,
        DoneAction,
        FailAction,
    ],
    Field(discriminator="action"),
]


class ActionResult(BaseModel):
    status: Literal[
        "executed",
        "failed",
        "blocked",
        "skipped",
        "confirmation_required",
    ]
    message: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class ScreenCapture(BaseModel):
    image_base64: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class TurnContext(BaseModel):
    step_index: int = Field(ge=0)
    last_action: DesktopAction | None = None
    last_result: ActionResult | None = None
    active_window: str | None = None
    trace_id: str | None = None


class Constraints(BaseModel):
    blocked_apps: list[str] = Field(default_factory=list)
    max_steps: int | None = Field(default=50, ge=1, le=1000)


class TurnRequest(BaseModel):
    session_id: str = Field(min_length=3, max_length=128)
    task: str = Field(min_length=1, max_length=10_000)
    screen: ScreenCapture
    context: TurnContext
    constraints: Constraints | None = None


class TurnResponse(BaseModel):
    observation: str
    reasoning: str
    action: DesktopAction
    risk: RiskLevel
    confidence: float = Field(ge=0, le=1)
    expected_outcome: str
    confirmation_required: bool = False
    confirmation_id: str | None = None
    trace_id: str

    @field_validator("confirmation_id")
    @classmethod
    def validate_confirmation_id(cls, value: str | None, info):
        if info.data.get("confirmation_required") and not value:
            raise ValueError("confirmation_id required when confirmation_required is true")
        return value


class StartSessionRequest(BaseModel):
    task: str = Field(min_length=1, max_length=10_000)
    constraints: Constraints | None = None


class StartSessionResponse(BaseModel):
    session_id: str
    created_at: datetime
    constraints: Constraints


class ConfirmRequest(BaseModel):
    confirmation_id: str = Field(min_length=1)
    approved: bool = True


class ConfirmResponse(BaseModel):
    session_id: str
    confirmation_id: str
    status: Literal["approved", "rejected", "not_found"]
