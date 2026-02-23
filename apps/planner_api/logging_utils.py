from __future__ import annotations

import logging
import sys


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s trace_id=%(trace_id)s message=%(message)s",
        stream=sys.stdout,
    )


class TraceAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        kwargs.setdefault("extra", {})
        kwargs["extra"].setdefault("trace_id", self.extra.get("trace_id", "n/a"))
        return msg, kwargs
