from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


@dataclass(slots=True)
class OCRToken:
    text: str
    bbox: tuple[int, int, int, int]
    confidence: float


def _normalize_conf(raw: Any) -> float:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if val > 1:
        return max(0.0, min(1.0, val / 100.0))
    return max(0.0, min(1.0, val))


def _ensure_tesseract_cmd(pytesseract_module) -> None:
    if shutil.which("tesseract"):
        return
    candidates = [
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            pytesseract_module.pytesseract.tesseract_cmd = str(candidate)
            return


def extract_ocr_tokens(image: Image.Image) -> list[OCRToken]:
    """Extract OCR tokens with bounding boxes.

    If pytesseract is unavailable, returns an empty list.
    """
    try:
        import pytesseract
    except ImportError:
        return []
    _ensure_tesseract_cmd(pytesseract)

    try:
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    except Exception as exc:
        # pytesseract can be importable while local tesseract binary is unavailable.
        if exc.__class__.__name__ in {"TesseractNotFoundError", "TesseractError"}:
            return []
        raise
    total = len(data.get("text", []))
    tokens: list[OCRToken] = []
    for i in range(total):
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        left = int(data["left"][i])
        top = int(data["top"][i])
        width = int(data["width"][i])
        height = int(data["height"][i])
        bbox = (left, top, left + width, top + height)
        tokens.append(OCRToken(text=text, bbox=bbox, confidence=_normalize_conf(data["conf"][i])))
    return tokens
