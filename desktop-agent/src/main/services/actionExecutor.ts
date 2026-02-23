import { Button, Key, keyboard, mouse, Point } from "@nut-tree-fork/nut-js";
import { spawn } from "node:child_process";
import type { AgentAction } from "../../shared/types";

export interface ActionResult {
  success: boolean;
  message: string;
}

keyboard.config.autoDelayMs = 50;
mouse.config.autoDelayMs = 100;
mouse.config.mouseSpeed = 1500;

const keyMap: Record<string, Key> = {
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  enter: Key.Enter,
  tab: Key.Tab,
  esc: Key.Escape,
  space: Key.Space,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  delete: Key.Delete,
  backspace: Key.Backspace,
  a: Key.A,
  c: Key.C,
  v: Key.V,
  x: Key.X,
  s: Key.S,
  n: Key.N,
  w: Key.W,
  f: Key.F,
  t: Key.T,
  r: Key.R,
  p: Key.P,
  z: Key.Z,
  y: Key.Y
};

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export async function executeAction(action: AgentAction): Promise<ActionResult> {
  const p = action.parameters;
  try {
    switch (action.action) {
      case "click":
        await mouse.setPosition(new Point(asNumber(p.x), asNumber(p.y)));
        await mouse.click(Button.LEFT);
        return { success: true, message: "Clicked successfully" };
      case "double_click":
        await mouse.setPosition(new Point(asNumber(p.x), asNumber(p.y)));
        await mouse.doubleClick(Button.LEFT);
        return { success: true, message: "Double-clicked successfully" };
      case "right_click":
        await mouse.setPosition(new Point(asNumber(p.x), asNumber(p.y)));
        await mouse.click(Button.RIGHT);
        return { success: true, message: "Right-clicked successfully" };
      case "type":
        await keyboard.type(asString(p.text));
        return { success: true, message: "Typed successfully" };
      case "hotkey": {
        const keys = Array.isArray(p.keys) ? p.keys.map((k) => keyMap[String(k).toLowerCase()]).filter(Boolean) : [];
        if (keys.length === 0) {
          return { success: false, message: "No valid keys provided" };
        }
        await keyboard.pressKey(...keys);
        await keyboard.releaseKey(...keys.reverse());
        return { success: true, message: "Hotkey executed" };
      }
      case "move":
        await mouse.setPosition(new Point(asNumber(p.x), asNumber(p.y)));
        return { success: true, message: "Cursor moved" };
      case "drag": {
        const from = Array.isArray(p.from) ? p.from : [0, 0];
        const to = Array.isArray(p.to) ? p.to : [0, 0];
        await mouse.setPosition(new Point(asNumber(from[0]), asNumber(from[1])));
        await mouse.pressButton(Button.LEFT);
        await mouse.setPosition(new Point(asNumber(to[0]), asNumber(to[1])));
        await mouse.releaseButton(Button.LEFT);
        return { success: true, message: "Dragged successfully" };
      }
      case "scroll": {
        const amount = asNumber(p.amount, 200);
        const direction = asString(p.direction, "down");
        if (direction === "up") {
          await mouse.scrollUp(amount);
        } else {
          await mouse.scrollDown(amount);
        }
        return { success: true, message: "Scrolled successfully" };
      }
      case "wait":
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, asNumber(p.seconds, 1)) * 1000));
        return { success: true, message: "Wait complete" };
      case "screenshot":
        return { success: true, message: "Screenshot acknowledged" };
      case "speak":
        return { success: false, message: "Speak action is not implemented in main process v1" };
      case "open_app": {
        const app = asString(p.app, asString((p.target as Record<string, unknown> | undefined)?.app));
        if (!app) {
          return { success: false, message: "open_app requires app name" };
        }
        if (process.platform !== "win32") {
          return { success: false, message: "open_app compatibility path only supports Windows" };
        }
        await new Promise<void>((resolve, reject) => {
          const child = spawn("cmd.exe", ["/c", "start", "", app], { windowsHide: true, stdio: "ignore" });
          child.on("spawn", () => resolve());
          child.on("error", reject);
        });
        return { success: true, message: `Opened app '${app}'` };
      }
      case "navigate_url": {
        const url = asString(p.url, asString((p.target as Record<string, unknown> | undefined)?.url));
        if (!url) {
          return { success: false, message: "navigate_url requires URL" };
        }
        if (process.platform !== "win32") {
          return { success: false, message: "navigate_url compatibility path only supports Windows" };
        }
        await new Promise<void>((resolve, reject) => {
          const child = spawn("cmd.exe", ["/c", "start", "", url], { windowsHide: true, stdio: "ignore" });
          child.on("spawn", () => resolve());
          child.on("error", reject);
        });
        return { success: true, message: `Opened URL '${url}'` };
      }
      case "click_element":
      case "focus_element":
      case "type_into_element":
      case "select_option":
        return { success: false, message: `Semantic action '${action.action}' requires semantic automation runtime` };
      case "done":
        return { success: true, message: asString(p.summary, "Task marked done") };
      case "fail":
        return { success: false, message: asString(p.reason, "Task failed") };
      default:
        return { success: false, message: "Unsupported action type" };
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Unknown action error" };
  }
}
