import type { AgentAction, IntentSpec, SemanticTarget } from "../../shared/types";
import { evaluateBrowserTarget } from "./browserPolicy";

export type SafetyReasonCode = "blocked_term" | "blocked_domain" | "requires_confirmation" | "target_unresolved";

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  reasonCode?: SafetyReasonCode;
}

const ALWAYS_BLOCK_TERMS = ["captcha", "bypass", "anti-bot", "unauthorized access"];
const CONFIRM_TERMS = ["delete", "remove", "format", "uninstall", "password", "api key", "token", "system settings", "registry", "wipe"];

function serializeAction(action: AgentAction): string {
  try {
    return JSON.stringify(action);
  } catch {
    return String(action.action);
  }
}

function extractSemanticTarget(action: AgentAction): SemanticTarget {
  const target = (action.parameters.target as SemanticTarget | undefined) ?? {};
  const url = typeof action.parameters.url === "string" ? action.parameters.url : target.url;
  const app = typeof action.parameters.app === "string" ? action.parameters.app : target.app;
  return {
    ...target,
    url,
    app
  };
}

function payloadIncludesAnyTerm(payload: string, terms: string[]): string | null {
  const lower = payload.toLowerCase();
  for (const term of terms) {
    if (lower.includes(term)) {
      return term;
    }
  }
  return null;
}

function intentAppearsDestructive(intent?: IntentSpec): boolean {
  if (!intent) return false;
  const text = `${intent.objective} ${intent.successCriteria}`.toLowerCase();
  return /\b(delete|remove|format|wipe|reset|uninstall|factory reset)\b/.test(text);
}

function actionAppearsDestructive(action: AgentAction): boolean {
  const payload = serializeAction(action).toLowerCase();
  return /\b(delete|remove|format|wipe|reset|uninstall|registry|system settings)\b/.test(payload);
}

export function requiresConfirmation(action: AgentAction): boolean {
  if (action.action === "done" || action.action === "fail" || action.action === "wait" || action.action === "screenshot") {
    return false;
  }
  const payload = serializeAction(action).toLowerCase();
  return payloadIncludesAnyTerm(payload, CONFIRM_TERMS) !== null;
}

export function requiresConfirmationForAction(action: AgentAction, intent?: IntentSpec): boolean {
  if (requiresConfirmation(action)) {
    return true;
  }
  if (action.action === "click_element") {
    const target = extractSemanticTarget(action);
    const isSendButton = (target.name ?? "").toLowerCase().includes("send");
    const isEmailFlow = /\b(gmail|email|mail)\b/.test(`${intent?.objective ?? ""}`.toLowerCase());
    if (isSendButton && isEmailFlow) {
      return true;
    }
  }
  if (!intent) {
    return false;
  }
  if (intent.constraints.requiresConfirmation) {
    return true;
  }
  return intentAppearsDestructive(intent) || actionAppearsDestructive(action);
}

function checkDomainPolicy(action: AgentAction): SafetyResult | null {
  if (action.action !== "navigate_url") {
    return null;
  }
  const target = extractSemanticTarget(action);
  if (!target.url) {
    return { allowed: false, reason: "navigate_url is missing target URL", reasonCode: "target_unresolved" };
  }
  const result = evaluateBrowserTarget(target.url);
  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason ?? "Domain blocked by policy",
      reasonCode: "blocked_domain"
    };
  }
  return null;
}

function checkSemanticTarget(action: AgentAction): SafetyResult | null {
  if (
    action.action !== "click_element" &&
    action.action !== "type_into_element" &&
    action.action !== "focus_element" &&
    action.action !== "select_option"
  ) {
    return null;
  }
  const target = extractSemanticTarget(action);
  if (!target.elementId && !target.selector && !target.name) {
    return { allowed: false, reason: "Semantic action target is unresolved", reasonCode: "target_unresolved" };
  }
  return null;
}

export function checkSafety(action: AgentAction, task: string, intent?: IntentSpec): SafetyResult {
  const payload = `${task} ${serializeAction(action)} ${intent?.objective ?? ""} ${intent?.successCriteria ?? ""}`.toLowerCase();

  const blockedTerm = payloadIncludesAnyTerm(payload, ALWAYS_BLOCK_TERMS);
  if (blockedTerm) {
    return {
      allowed: false,
      reason: `blocked term detected: ${blockedTerm}`,
      reasonCode: "blocked_term"
    };
  }

  if (intent?.constraints?.forbiddenTerms?.length) {
    const forbidden = payloadIncludesAnyTerm(payload, intent.constraints.forbiddenTerms.map((term) => term.toLowerCase()));
    if (forbidden) {
      return {
        allowed: false,
        reason: `blocked by intent constraint: ${forbidden}`,
        reasonCode: "blocked_term"
      };
    }
  }

  const domainCheck = checkDomainPolicy(action);
  if (domainCheck) {
    return domainCheck;
  }

  const targetCheck = checkSemanticTarget(action);
  if (targetCheck) {
    return targetCheck;
  }

  return { allowed: true };
}
