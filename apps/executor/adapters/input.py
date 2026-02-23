from __future__ import annotations

import logging
import time

from pydantic import TypeAdapter

from packages.contracts.models import DesktopAction

logger = logging.getLogger("executor.input")


class DesktopInputExecutor:
    def __init__(self, dry_run: bool = True) -> None:
        self.dry_run = dry_run
        self._pyautogui = None
        if not dry_run:
            try:
                import pyautogui
            except ImportError as exc:
                raise RuntimeError("pyautogui required for non-dry-run mode") from exc
            self._pyautogui = pyautogui

    def execute(self, action: DesktopAction | dict) -> str:
        parsed = TypeAdapter(DesktopAction).validate_python(action)
        if self.dry_run:
            logger.info("dry-run execute action=%s", parsed.action)
            return f"dry-run:{parsed.action}"

        assert self._pyautogui is not None
        pg = self._pyautogui
        match parsed.action:
            case "click":
                pg.click(parsed.parameters.x, parsed.parameters.y)
            case "double_click":
                pg.doubleClick(parsed.parameters.x, parsed.parameters.y)
            case "right_click":
                pg.rightClick(parsed.parameters.x, parsed.parameters.y)
            case "type":
                pg.write(parsed.parameters.text, interval=0.01)
            case "hotkey":
                pg.hotkey(*parsed.parameters.keys)
            case "scroll":
                amount = parsed.parameters.amount
                pg.scroll(amount if parsed.parameters.direction == "up" else -amount)
            case "move":
                pg.moveTo(parsed.parameters.x, parsed.parameters.y)
            case "drag":
                fx, fy = parsed.parameters.from_
                tx, ty = parsed.parameters.to
                pg.moveTo(fx, fy)
                pg.dragTo(tx, ty, duration=0.2, button="left")
            case "wait":
                time.sleep(parsed.parameters.seconds)
            case "screenshot":
                pass
            case "done":
                return parsed.parameters.summary
            case "fail":
                return parsed.parameters.reason
            case _:
                raise ValueError(f"unsupported action: {parsed.action}")

        return f"executed:{parsed.action}"
