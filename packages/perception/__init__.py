"""Perception pipeline for OCR and UI grounding."""

from .grounding import UICandidate, generate_ui_candidates
from .ocr import OCRToken, extract_ocr_tokens
from .pipeline import PerceptionSnapshot, analyze_screen

__all__ = [
    "OCRToken",
    "UICandidate",
    "PerceptionSnapshot",
    "extract_ocr_tokens",
    "generate_ui_candidates",
    "analyze_screen",
]
