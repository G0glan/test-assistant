from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image


def decode_base64_image(image_base64: str) -> Image.Image:
    raw = base64.b64decode(image_base64)
    return Image.open(BytesIO(raw)).convert("RGB")


def encode_image_to_base64(image: Image.Image, fmt: str = "PNG") -> str:
    buf = BytesIO()
    image.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("ascii")
