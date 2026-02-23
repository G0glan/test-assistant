from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO

from PIL import ImageGrab


@dataclass(slots=True)
class ScreenAdapter:
    image_base64: str
    width: int
    height: int


def capture_screen() -> ScreenAdapter:
    image = ImageGrab.grab(all_screens=True)
    width, height = image.size
    buf = BytesIO()
    image.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return ScreenAdapter(image_base64=encoded, width=width, height=height)
