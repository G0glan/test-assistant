from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from pydantic import TypeAdapter

from .models import DesktopAction


def new_trace_id() -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"trace_{ts}_{uuid.uuid4().hex[:10]}"


def action_fingerprint(action: DesktopAction) -> str:
    payload = TypeAdapter(DesktopAction).dump_python(action, mode="json", by_alias=True)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
