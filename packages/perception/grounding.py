from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .ocr import OCRToken


@dataclass(slots=True)
class UICandidate:
    kind: Literal["button", "input", "text"]
    center: tuple[int, int]
    text: str
    bbox: tuple[int, int, int, int]
    score: float


BUTTON_TERMS = {
    "ok",
    "save",
    "send",
    "submit",
    "continue",
    "next",
    "search",
    "open",
    "cancel",
    "allow",
}
INPUT_TERMS = {
    "search",
    "username",
    "email",
    "password",
    "name",
    "address",
}


def _center(bbox: tuple[int, int, int, int]) -> tuple[int, int]:
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def generate_ui_candidates(tokens: list[OCRToken], width: int, height: int) -> list[UICandidate]:
    _ = (width, height)
    candidates: list[UICandidate] = []
    for token in tokens:
        lowered = token.text.lower()
        kind: Literal["button", "input", "text"] = "text"
        score = token.confidence
        if lowered in BUTTON_TERMS:
            kind = "button"
            score = max(0.6, score)
        elif lowered in INPUT_TERMS or lowered.endswith(":"):
            kind = "input"
            score = max(0.55, score)
        candidates.append(
            UICandidate(
                kind=kind,
                center=_center(token.bbox),
                text=token.text,
                bbox=token.bbox,
                score=score,
            )
        )
    return sorted(candidates, key=lambda c: c.score, reverse=True)
