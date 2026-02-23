from __future__ import annotations

import logging
import sys


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s trace_id=%(trace_id)s message=%(message)s",
        stream=sys.stdout,
    )


class TraceAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        kwargs.setdefault("extra", {})
        kwargs["extra"].setdefault("trace_id", self.extra.get("trace_id", "n/a"))
        return msg, kwargs
