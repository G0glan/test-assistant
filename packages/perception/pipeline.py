from __future__ import annotations

from dataclasses import dataclass

from packages.contracts.models import ScreenCapture

from .grounding import UICandidate, generate_ui_candidates
from .image_utils import decode_base64_image
from .ocr import OCRToken, extract_ocr_tokens


@dataclass(slots=True)
class PerceptionSnapshot:
    tokens: list[OCRToken]
    candidates: list[UICandidate]


def analyze_screen(screen: ScreenCapture) -> PerceptionSnapshot:
    image = decode_base64_image(screen.image_base64)
    tokens = extract_ocr_tokens(image)
    candidates = generate_ui_candidates(tokens, screen.width, screen.height)
    return PerceptionSnapshot(tokens=tokens, candidates=candidates)
