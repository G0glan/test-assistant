import type { AgentAction, IntentSpec, PerceptionSource, SemanticTarget } from "../../../shared/types";
import WebSocket, { type RawData } from "ws";
import { evaluateBrowserTarget } from "../browserPolicy";
import { activateTab, ensureChromeSession, getActiveTab, openUrlInSystemChrome } from "./chromeSession";

export interface AdapterExecutionResult {
  success: boolean;
  message: string;
  perceptionSource: PerceptionSource;
  retryable?: boolean;
  errorCode?: string;
  evidence?: Record<string, unknown>;
}

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

class ChromeAdapterError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code: string, retryable = true) {
    super(message);
    this.name = "ChromeAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

function asChromeAdapterError(error: unknown): ChromeAdapterError {
  if (error instanceof ChromeAdapterError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Chrome adapter execution failed";
  return new ChromeAdapterError(message, "transient_surface_error", true);
}

const CDP_UNAVAILABLE_COOLDOWN_MS = 15000;
let cdpUnavailableUntil = 0;
let cdpUnavailableReason = "";

function markCdpUnavailable(reason: string): void {
  cdpUnavailableUntil = Date.now() + CDP_UNAVAILABLE_COOLDOWN_MS;
  cdpUnavailableReason = reason;
}

function clearCdpUnavailable(): void {
  cdpUnavailableUntil = 0;
  cdpUnavailableReason = "";
}

function getCdpUnavailableError(): ChromeAdapterError | null {
  if (Date.now() >= cdpUnavailableUntil) {
    return null;
  }
  const detail = cdpUnavailableReason || "runtime is temporarily unavailable";
  return new ChromeAdapterError(`CDP temporarily unavailable (${detail})`, "cdp_unavailable", true);
}

class CdpClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, PendingCommand>();

  async connect(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error("CDP connection timeout")), 5000);
      let opened = false;

      socket.once("open", () => {
        opened = true;
        clearTimeout(timeout);
        this.ws = socket;
        resolve();
      });

      socket.on("message", (data: RawData) => {
        const payloadRaw =
          typeof data === "string" ? data : data instanceof Buffer ? data.toString("utf8") : String(data ?? "");
        let payload: any;
        try {
          payload = JSON.parse(payloadRaw);
        } catch {
          return;
        }
        if (payload.id && this.pending.has(payload.id)) {
          const request = this.pending.get(payload.id);
          this.pending.delete(payload.id);
          if (payload.error) {
            request?.reject(new Error(payload.error.message || "CDP command failed"));
          } else {
            request?.resolve(payload.result);
          }
        }
      });

      socket.on("error", (err: Error) => {
        clearTimeout(timeout);
        if (!opened) {
          reject(err instanceof Error ? err : new Error("CDP connection error"));
        }
      });

      socket.on("close", () => {
        this.ws = null;
      });
    });
  }

  async send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP is not connected");
    }
    const id = ++this.seq;
    const command = { id, method, params: params ?? {} };
    const resultPromise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.ws.send(JSON.stringify(command));
    return await resultPromise;
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // no-op
      }
    }
    this.ws = null;
    this.pending.clear();
  }
}

function buildCandidateExpression(target: SemanticTarget): string {
  const selector = target.selector ? JSON.stringify(target.selector) : null;
  const role = target.role ? JSON.stringify(target.role) : null;
  const name = target.name ? JSON.stringify(target.name.toLowerCase()) : null;
  const elementId = target.elementId ? JSON.stringify(target.elementId) : null;
  return `(() => {
    const clickable = (el) => {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      const role = (el.getAttribute?.("role") || "").toLowerCase();
      return tag === "button" || tag === "a" || role === "button" || typeof el.onclick === "function";
    };
    let el = null;
    if (${selector ? "true" : "false"}) {
      try { el = document.querySelector(${selector}); } catch {}
    }
    if (!el && ${elementId ? "true" : "false"}) {
      el = document.getElementById(${elementId});
    }
    if (!el && ${role ? "true" : "false"}) {
      el = document.querySelector('[role=' + ${role} + ']');
    }
    if (!el && ${name ? "true" : "false"}) {
      const candidate = Array.from(document.querySelectorAll("button, a, input, textarea, [role], [contenteditable='true'], select"));
      const needle = ${name};
      el = candidate.find((node) => {
        const txt = ((node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("name") || "") + "").toLowerCase();
        return txt.includes(needle) || (clickable(node) && txt.startsWith(needle));
      }) || null;
    }
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      selectorHint: el.id ? "#" + el.id : (el.tagName || "").toLowerCase(),
      tag: (el.tagName || "").toLowerCase(),
      text: ((el.innerText || el.textContent || el.getAttribute("aria-label") || "") + "").slice(0, 120)
    };
  })()`;
}

async function evaluateElementCenter(client: CdpClient, target: SemanticTarget): Promise<Record<string, unknown> | null> {
  const expression = buildCandidateExpression(target);
  const result = await client.send<{ result?: { value?: Record<string, unknown> | null } }>("Runtime.evaluate", {
    expression,
    returnByValue: true
  });
  return result?.result?.value ?? null;
}

async function clickAt(client: CdpClient, x: number, y: number): Promise<void> {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", clickCount: 0 });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function getConnectedClient(): Promise<{ client: CdpClient; tabId: string }> {
  const unavailable = getCdpUnavailableError();
  if (unavailable) {
    throw unavailable;
  }

  try {
    await ensureChromeSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chrome CDP endpoint is unavailable";
    markCdpUnavailable(message);
    throw new ChromeAdapterError(message, "cdp_unavailable", true);
  }

  let tab: Awaited<ReturnType<typeof getActiveTab>> = null;
  try {
    tab = await getActiveTab();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query Chrome tabs";
    markCdpUnavailable(message);
    throw new ChromeAdapterError(message, "cdp_unavailable", true);
  }

  if (!tab) {
    markCdpUnavailable("no active debuggable tab");
    throw new ChromeAdapterError("No active Chrome tab is available for CDP attach", "cdp_no_active_tab", true);
  }
  if (!tab.webSocketDebuggerUrl) {
    markCdpUnavailable("active tab has no debugger websocket URL");
    throw new ChromeAdapterError("Active Chrome tab has no debugger websocket URL", "cdp_unavailable", true);
  }

  try {
    await activateTab(tab.id);
  } catch {
    // Activation is best-effort. Continue even if Chrome rejects activation.
  }

  const client = new CdpClient();
  try {
    await client.connect(tab.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
  } catch (error) {
    client.close();
    const message = error instanceof Error ? error.message : "Could not connect to active Chrome tab";
    markCdpUnavailable(message);
    throw new ChromeAdapterError(message, "cdp_unavailable", true);
  }

  clearCdpUnavailable();
  return { client, tabId: tab.id };
}

async function executeNavigate(action: AgentAction): Promise<AdapterExecutionResult> {
  const requestedUrl = String(action.parameters.url ?? action.parameters.target?.url ?? "");
  const policy = evaluateBrowserTarget(requestedUrl);
  if (!policy.allowed) {
    return {
      success: false,
      message: policy.reason ?? "Navigation blocked by domain policy",
      perceptionSource: "chrome_cdp",
      errorCode: policy.reasonCode ?? "blocked_domain"
    };
  }

  try {
    const { client, tabId } = await getConnectedClient();
    try {
      await client.send("Page.navigate", { url: policy.normalizedUrl });
      await client.send("Runtime.evaluate", { expression: "window.location.href", returnByValue: true });
      return {
        success: true,
        message: `Navigated to ${policy.normalizedUrl}`,
        perceptionSource: "chrome_cdp",
        evidence: { finalUrl: policy.normalizedUrl, tabId }
      };
    } finally {
      client.close();
    }
  } catch (error) {
    const cdpError = asChromeAdapterError(error);
    if (policy.normalizedUrl && openUrlInSystemChrome(policy.normalizedUrl)) {
      return {
        success: true,
        message: `Opened ${policy.normalizedUrl} via system Chrome shell fallback`,
        perceptionSource: "browser_shell",
        evidence: {
          finalUrl: policy.normalizedUrl,
          browserMode: "shell_fallback",
          semanticFailure: cdpError.message,
          semanticFailureCode: cdpError.code
        }
      };
    }
    return {
      success: false,
      message: cdpError.message,
      perceptionSource: "chrome_cdp",
      retryable: cdpError.retryable,
      errorCode: cdpError.code
    };
  }
}

async function executeOpenChrome(action: AgentAction): Promise<AdapterExecutionResult> {
  const app = String(action.parameters.app ?? action.parameters.target?.app ?? "chrome").toLowerCase();
  if (!app.includes("chrome")) {
    return {
      success: false,
      message: `Chrome adapter cannot open non-Chrome app: ${app}`,
      perceptionSource: "chrome_cdp",
      errorCode: "target_unresolved"
    };
  }

  try {
    await ensureChromeSession();
    const tab = await getActiveTab();
    return {
      success: true,
      message: tab ? "Chrome session is ready" : "Chrome started (no active tab exposed to CDP yet)",
      perceptionSource: "chrome_cdp",
      evidence: {
        app: "chrome",
        browserMode: "cdp",
        hasActiveTab: Boolean(tab),
        tabId: tab?.id
      }
    };
  } catch (error) {
    const cdpError = asChromeAdapterError(error);
    return {
      success: false,
      message: cdpError.message,
      perceptionSource: "chrome_cdp",
      retryable: cdpError.retryable,
      errorCode: "cdp_unavailable"
    };
  }
}

async function executeElementAction(action: AgentAction, intent: IntentSpec | null): Promise<AdapterExecutionResult> {
  const target = (action.parameters.target as SemanticTarget | undefined) ?? {
    name: intent?.targets.element,
    role: undefined
  };
  let client: CdpClient;
  try {
    ({ client } = await getConnectedClient());
  } catch (error) {
    const cdpError = asChromeAdapterError(error);
    return {
      success: false,
      message: cdpError.message,
      perceptionSource: "chrome_cdp",
      retryable: cdpError.retryable,
      errorCode: cdpError.code === "cdp_no_active_tab" ? "cdp_unavailable" : cdpError.code
    };
  }

  try {
    const center = await evaluateElementCenter(client, target);
    const x = Number(center?.x);
    const y = Number(center?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return {
        success: false,
        message: "Could not resolve browser element target",
        perceptionSource: "chrome_cdp",
        retryable: true,
        errorCode: "target_not_found"
      };
    }

    if (action.action === "click_element") {
      await clickAt(client, x, y);
      return {
        success: true,
        message: "Clicked browser element",
        perceptionSource: "chrome_cdp",
        evidence: {
          resolvedSelector: center?.selectorHint,
          resolvedNodeId: center?.tag,
          x,
          y
        }
      };
    }

    if (action.action === "focus_element") {
      await client.send("Runtime.evaluate", {
        expression: `${buildCandidateExpression(target)} && document.activeElement && true`,
        returnByValue: true
      });
      await clickAt(client, x, y);
      return {
        success: true,
        message: "Focused browser element",
        perceptionSource: "chrome_cdp",
        evidence: {
          resolvedSelector: center?.selectorHint,
          x,
          y
        }
      };
    }

    if (action.action === "type_into_element") {
      const text = String(action.parameters.text ?? target.text ?? "");
      await clickAt(client, x, y);
      await client.send("Input.insertText", { text });
      return {
        success: true,
        message: "Typed into browser element",
        perceptionSource: "chrome_cdp",
        evidence: {
          resolvedSelector: center?.selectorHint,
          resolvedNodeId: center?.tag,
          x,
          y
        }
      };
    }

    if (action.action === "select_option") {
      const value = String(action.parameters.value ?? action.parameters.option ?? target.text ?? "");
      const selector = target.selector;
      if (!selector) {
        return {
          success: false,
          message: "select_option currently requires target.selector",
          perceptionSource: "chrome_cdp",
          errorCode: "target_unresolved"
        };
      }
      const expression = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: "not_found" };
        if (!(el instanceof HTMLSelectElement)) return { ok: false, reason: "not_select" };
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: el.value };
      })()`;
      const result = await client.send<{ result?: { value?: { ok?: boolean; reason?: string } } }>("Runtime.evaluate", {
        expression,
        returnByValue: true
      });
      if (!result?.result?.value?.ok) {
        return {
          success: false,
          message: `Failed selecting option (${result?.result?.value?.reason ?? "unknown"})`,
          perceptionSource: "chrome_cdp",
          errorCode: "target_not_found"
        };
      }
      return {
        success: true,
        message: "Selected option in browser element",
        perceptionSource: "chrome_cdp",
        evidence: { resolvedSelector: selector, selectedValue: value }
      };
    }

    return {
      success: false,
      message: "Unsupported browser semantic action",
      perceptionSource: "chrome_cdp",
      errorCode: "unsupported_action"
    };
  } finally {
    client.close();
  }
}

export async function executeChromeSemanticAction(action: AgentAction, intent: IntentSpec | null): Promise<AdapterExecutionResult> {
  try {
    switch (action.action) {
      case "navigate_url":
        return await executeNavigate(action);
      case "open_app":
        return await executeOpenChrome(action);
      case "click_element":
      case "focus_element":
      case "type_into_element":
      case "select_option":
        return await executeElementAction(action, intent);
      default:
        return {
          success: false,
          message: `Action ${action.action} is not supported by Chrome adapter`,
          perceptionSource: "chrome_cdp",
          errorCode: "unsupported_action"
        };
    }
  } catch (error) {
    const cdpError = asChromeAdapterError(error);
    return {
      success: false,
      message: cdpError.message,
      perceptionSource: "chrome_cdp",
      retryable: cdpError.retryable,
      errorCode: cdpError.code
    };
  }
}
