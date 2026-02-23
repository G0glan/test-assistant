import { spawn } from "node:child_process";
import type { AgentAction, IntentSpec, PerceptionSource, SemanticTarget } from "../../shared/types";
import { evaluateBrowserTarget } from "./browserPolicy";
import { executeChromeSemanticAction } from "./adapters/chromeAdapter";
import { getUiaSidecarManager } from "./adapters/uiaSidecarManager";
import { UiaClient } from "./adapters/uiaClient";

export interface SemanticExecutionContext {
  task: string;
  stepIndex: number;
  activeWindow?: string;
}

export interface SemanticExecutionResult {
  success: boolean;
  message: string;
  perceptionSource: PerceptionSource;
  retryable?: boolean;
  errorCode?: string;
  evidence?: Record<string, unknown>;
}

const CHROME_HINTS = ["chrome", "google chrome"];

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function isSemanticAutomationEnabled(): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  return envFlag("AGENT_SEMANTIC_AUTOMATION_ENABLED", true);
}

function getTarget(action: AgentAction, intent: IntentSpec | null): SemanticTarget {
  const fromAction = (action.parameters.target as SemanticTarget | undefined) ?? {};
  return {
    app: fromAction.app ?? intent?.targetApp ?? intent?.targets.app,
    url: fromAction.url ?? (typeof action.parameters.url === "string" ? action.parameters.url : intent?.targets.url),
    selector: fromAction.selector,
    role: fromAction.role,
    name: fromAction.name ?? intent?.targets.element,
    elementId: fromAction.elementId,
    windowTitle: fromAction.windowTitle ?? intent?.targetWindow,
    text: fromAction.text ?? (typeof action.parameters.text === "string" ? action.parameters.text : intent?.targets.text),
    coords: fromAction.coords ?? intent?.targets.coords
  };
}

function shouldRouteToChrome(action: AgentAction, intent: IntentSpec | null, target: SemanticTarget): boolean {
  if (action.action === "navigate_url") {
    return true;
  }
  if (target.selector || target.elementId) return true;
  const appHint = `${target.app ?? ""} ${intent?.targetApp ?? ""}`.toLowerCase();
  if (CHROME_HINTS.some((hint) => appHint.includes(hint)) && action.action === "open_app") {
    return true;
  }
  if (intent?.preferredSurface === "browser" && (target.selector || target.elementId)) {
    return true;
  }
  return false;
}

function openDesktopApp(appName: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      const child = spawn("cmd.exe", ["/c", "start", "", appName], {
        windowsHide: true,
        stdio: "ignore"
      });
      child.on("error", () => resolve(false));
      child.on("spawn", () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

async function executeViaUia(action: AgentAction, target: SemanticTarget): Promise<SemanticExecutionResult> {
  const manager = getUiaSidecarManager();
  const started = await manager.ensureStarted();
  if (!started) {
    return {
      success: false,
      message: "Windows UIA sidecar is unavailable. Run scripts/bootstrap-sidecar.ps1 first.",
      perceptionSource: "uia",
      retryable: true,
      errorCode: "surface_unavailable"
    };
  }

  const client = new UiaClient();
  switch (action.action) {
    case "click_element": {
      const result = await client.click(target);
      return {
        success: result.ok,
        message: result.message ?? (result.ok ? "Clicked desktop element via UIA" : "UIA click failed"),
        perceptionSource: "uia",
        retryable: !result.ok,
        errorCode: result.errorCode ?? (result.ok ? undefined : "target_not_found"),
        evidence: result.data as Record<string, unknown> | undefined
      };
    }
    case "focus_element": {
      const result = await client.focus(target);
      return {
        success: result.ok,
        message: result.message ?? (result.ok ? "Focused desktop element via UIA" : "UIA focus failed"),
        perceptionSource: "uia",
        retryable: !result.ok,
        errorCode: result.errorCode ?? (result.ok ? undefined : "target_not_found"),
        evidence: result.data as Record<string, unknown> | undefined
      };
    }
    case "type_into_element": {
      const text = String(action.parameters.text ?? target.text ?? "");
      const result = await client.type(target, text);
      return {
        success: result.ok,
        message: result.message ?? (result.ok ? "Typed into desktop element via UIA" : "UIA type failed"),
        perceptionSource: "uia",
        retryable: !result.ok,
        errorCode: result.errorCode ?? (result.ok ? undefined : "target_not_found"),
        evidence: result.data as Record<string, unknown> | undefined
      };
    }
    case "select_option": {
      const result = await client.focus(target);
      return {
        success: result.ok,
        message: result.message ?? (result.ok ? "Focused option target via UIA" : "UIA select failed"),
        perceptionSource: "uia",
        retryable: !result.ok,
        errorCode: result.errorCode ?? (result.ok ? undefined : "target_not_found"),
        evidence: result.data as Record<string, unknown> | undefined
      };
    }
    case "open_app": {
      const app = target.app ?? String(action.parameters.app ?? "");
      if (!app) {
        return {
          success: false,
          message: "open_app requires target app name",
          perceptionSource: "uia",
          errorCode: "target_unresolved"
        };
      }
      const opened = await openDesktopApp(app);
      return {
        success: opened,
        message: opened ? `Opened app '${app}'` : `Failed to open app '${app}'`,
        perceptionSource: "uia",
        retryable: !opened,
        errorCode: opened ? undefined : "target_not_found",
        evidence: { app }
      };
    }
    default:
      return {
        success: false,
        message: `Action ${action.action} is not supported by UIA adapter`,
        perceptionSource: "uia",
        errorCode: "unsupported_action"
      };
  }
}

export async function executeSemanticAction(
  action: AgentAction,
  intent: IntentSpec | null,
  _context: SemanticExecutionContext
): Promise<SemanticExecutionResult> {
  const target = getTarget(action, intent);

  if (action.action === "navigate_url") {
    const url = target.url ?? String(action.parameters.url ?? "");
    const policy = evaluateBrowserTarget(url);
    if (!policy.allowed) {
      return {
        success: false,
        message: policy.reason ?? "Navigation blocked by browser policy",
        perceptionSource: "chrome_cdp",
        errorCode: policy.reasonCode ?? "blocked_domain"
      };
    }
  }

  if (shouldRouteToChrome(action, intent, target)) {
    return await executeChromeSemanticAction(
      {
        ...action,
        parameters: {
          ...action.parameters,
          target
        }
      },
      intent
    );
  }

  return await executeViaUia(
    {
      ...action,
      parameters: {
        ...action.parameters,
        target
      }
    },
    target
  );
}
