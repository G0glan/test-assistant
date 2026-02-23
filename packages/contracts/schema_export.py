from __future__ import annotations

import json
from pathlib import Path

from .models import (
    ConfirmRequest,
    ConfirmResponse,
    StartSessionRequest,
    StartSessionResponse,
    TurnRequest,
    TurnResponse,
)


def export_schemas(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    schemas = {
        "turn_request.schema.json": TurnRequest.model_json_schema(),
        "turn_response.schema.json": TurnResponse.model_json_schema(),
        "start_session_request.schema.json": StartSessionRequest.model_json_schema(),
        "start_session_response.schema.json": StartSessionResponse.model_json_schema(),
        "confirm_request.schema.json": ConfirmRequest.model_json_schema(),
        "confirm_response.schema.json": ConfirmResponse.model_json_schema(),
    }
    for name, schema in schemas.items():
        (output_dir / name).write_text(json.dumps(schema, indent=2), encoding="utf-8")


if __name__ == "__main__":
    export_schemas(Path(__file__).resolve().parent / "schemas")
