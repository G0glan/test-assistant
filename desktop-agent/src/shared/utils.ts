import type { AgentAction } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseJsonAction(raw: string): AgentAction | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as AgentAction;
    if (!parsed || typeof parsed !== "object" || typeof parsed.action !== "string") {
      return null;
    }
    if (!parsed.parameters || typeof parsed.parameters !== "object" || Array.isArray(parsed.parameters)) {
      parsed.parameters = {};
    }
    return parsed;
  } catch {
    return null;
  }
}

export function safeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
