import type { AgentAction, AgentActionType, SemanticTarget } from "../../shared/types";

const KNOWN_ACTIONS: AgentActionType[] = [
  "click",
  "double_click",
  "right_click",
  "type",
  "hotkey",
  "scroll",
  "move",
  "drag",
  "wait",
  "screenshot",
  "speak",
  "click_element",
  "type_into_element",
  "focus_element",
  "select_option",
  "navigate_url",
  "open_app",
  "done",
  "fail"
];

const KNOWN_ACTIONS_SET = new Set(KNOWN_ACTIONS);

const RETRYABLE_ERROR_CODES = new Set(["target_not_found", "stale_element", "transient_surface_error"]);

export interface NormalizedActionResult {
  ok: boolean;
  action?: AgentAction;
  error?: string;
  errorCode?: string;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTarget(raw: unknown): SemanticTarget {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const t = raw as Record<string, unknown>;
  const coordsX = toNumber((t.coords as Record<string, unknown> | undefined)?.x);
  const coordsY = toNumber((t.coords as Record<string, unknown> | undefined)?.y);
  return {
    elementId: typeof t.elementId === "string" ? t.elementId : undefined,
    role: typeof t.role === "string" ? t.role : undefined,
    name: typeof t.name === "string" ? t.name : undefined,
    app: typeof t.app === "string" ? t.app : undefined,
    windowTitle: typeof t.windowTitle === "string" ? t.windowTitle : undefined,
    selector: typeof t.selector === "string" ? t.selector : undefined,
    url: typeof t.url === "string" ? t.url : undefined,
    text: typeof t.text === "string" ? t.text : undefined,
    coords: coordsX !== null && coordsY !== null ? { x: Math.round(coordsX), y: Math.round(coordsY) } : undefined
  };
}

function normalizeCoordinatesAction(action: AgentAction, width: number, height: number): NormalizedActionResult {
  const p = { ...action.parameters };
  const x = toNumber(p.x);
  const y = toNumber(p.y);
  if (x === null || y === null) {
    return { ok: false, error: "Missing x/y coordinates", errorCode: "invalid_coordinates" };
  }
  p.x = clamp(Math.round(x), 0, Math.max(0, width - 1));
  p.y = clamp(Math.round(y), 0, Math.max(0, height - 1));
  return { ok: true, action: { ...action, parameters: p } };
}

function normalizeDragAction(action: AgentAction, width: number, height: number): NormalizedActionResult {
  const p = { ...action.parameters };
  const from = Array.isArray(p.from) ? p.from : null;
  const to = Array.isArray(p.to) ? p.to : null;
  if (!from || !to || from.length < 2 || to.length < 2) {
    return { ok: false, error: "Drag requires from/to arrays", errorCode: "invalid_drag_payload" };
  }
  const fx = toNumber(from[0]);
  const fy = toNumber(from[1]);
  const tx = toNumber(to[0]);
  const ty = toNumber(to[1]);
  if ([fx, fy, tx, ty].some((v) => v === null)) {
    return { ok: false, error: "Drag coordinates are invalid", errorCode: "invalid_drag_payload" };
  }
  p.from = [clamp(Math.round(fx as number), 0, Math.max(0, width - 1)), clamp(Math.round(fy as number), 0, Math.max(0, height - 1))];
  p.to = [clamp(Math.round(tx as number), 0, Math.max(0, width - 1)), clamp(Math.round(ty as number), 0, Math.max(0, height - 1))];
  return { ok: true, action: { ...action, parameters: p } };
}

function normalizeHotkey(action: AgentAction): NormalizedActionResult {
  const p = { ...action.parameters };
  const keys = Array.isArray(p.keys) ? p.keys : [];
  const normalized = keys
    .map((k) => String(k).trim().toLowerCase())
    .filter((k) => /^[a-z0-9]+$/.test(k));
  if (!normalized.length) {
    return { ok: false, error: "Hotkey requires valid keys array", errorCode: "invalid_hotkey" };
  }
  p.keys = normalized;
  return { ok: true, action: { ...action, parameters: p } };
}

function normalizeScroll(action: AgentAction): NormalizedActionResult {
  const p = { ...action.parameters };
  const direction = String(p.direction ?? "down").toLowerCase() === "up" ? "up" : "down";
  const rawAmount = toNumber(p.amount) ?? 250;
  p.direction = direction;
  p.amount = clamp(Math.round(rawAmount), 10, 2400);
  return { ok: true, action: { ...action, parameters: p } };
}

function normalizeWait(action: AgentAction): NormalizedActionResult {
  const p = { ...action.parameters };
  const seconds = toNumber(p.seconds) ?? 1;
  p.seconds = clamp(seconds, 0.1, 30);
  return { ok: true, action: { ...action, parameters: p } };
}

function normalizeSemanticAction(action: AgentAction): NormalizedActionResult {
  const p = { ...action.parameters };
  const target = normalizeTarget(p.target);
  p.target = target;

  const url = typeof p.url === "string" ? p.url : target.url;
  const app = typeof p.app === "string" ? p.app : target.app;

  switch (action.action) {
    case "navigate_url":
      if (!url) {
        return { ok: false, error: "navigate_url requires url", errorCode: "missing_target_url" };
      }
      p.url = url;
      p.target = { ...target, url };
      return { ok: true, action: { ...action, parameters: p } };
    case "open_app":
      if (!app) {
        return { ok: false, error: "open_app requires app", errorCode: "missing_target_app" };
      }
      p.app = app;
      p.target = { ...target, app };
      return { ok: true, action: { ...action, parameters: p } };
    case "type_into_element": {
      const text = typeof p.text === "string" ? p.text : target.text;
      if (!text) {
        return { ok: false, error: "type_into_element requires text", errorCode: "missing_target_text" };
      }
      if (!target.elementId && !target.selector && !target.name) {
        return { ok: false, error: "type_into_element requires a target", errorCode: "target_unresolved" };
      }
      p.text = text;
      p.target = { ...target, text };
      return { ok: true, action: { ...action, parameters: p } };
    }
    case "click_element":
    case "focus_element":
    case "select_option":
      if (!target.elementId && !target.selector && !target.name) {
        return { ok: false, error: `${action.action} requires semantic target`, errorCode: "target_unresolved" };
      }
      return { ok: true, action: { ...action, parameters: p } };
    default:
      return { ok: true, action: { ...action, parameters: p } };
  }
}

export function isSemanticAction(action: AgentAction): boolean {
  return (
    action.action === "click_element" ||
    action.action === "type_into_element" ||
    action.action === "focus_element" ||
    action.action === "select_option" ||
    action.action === "navigate_url" ||
    action.action === "open_app"
  );
}

export function isRetryableSemanticError(errorCode?: string): boolean {
  if (!errorCode) return false;
  return RETRYABLE_ERROR_CODES.has(errorCode);
}

export function normalizeAction(raw: AgentAction, width: number, height: number): NormalizedActionResult {
  if (!raw || typeof raw !== "object" || typeof raw.action !== "string" || typeof raw.parameters !== "object" || raw.parameters === null) {
    return { ok: false, error: "Action payload is not valid JSON object", errorCode: "invalid_action_payload" };
  }

  if (!KNOWN_ACTIONS_SET.has(raw.action)) {
    return { ok: false, error: `Unsupported action '${raw.action}'`, errorCode: "unsupported_action" };
  }

  switch (raw.action) {
    case "click":
    case "double_click":
    case "right_click":
    case "move":
      return normalizeCoordinatesAction(raw, width, height);
    case "drag":
      return normalizeDragAction(raw, width, height);
    case "hotkey":
      return normalizeHotkey(raw);
    case "scroll":
      return normalizeScroll(raw);
    case "wait":
      return normalizeWait(raw);
    case "click_element":
    case "type_into_element":
    case "focus_element":
    case "select_option":
    case "navigate_url":
    case "open_app":
      return normalizeSemanticAction(raw);
    default:
      return { ok: true, action: raw };
  }
}
