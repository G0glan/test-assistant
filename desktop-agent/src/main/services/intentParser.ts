import OpenAI from "openai";
import type { IntentParseResult, IntentSpec } from "../../shared/types";

const DEFAULT_FORBIDDEN_TERMS = ["captcha bypass", "anti-bot bypass", "unauthorized access"];

export interface IntentParserUsageEvent {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeTokenCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function defaultUnknownIntent(userCommand: string): IntentSpec {
  return {
    intentType: "unknown",
    objective: userCommand,
    preferredSurface: "desktop",
    targets: {},
    constraints: {
      forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS],
      requiresConfirmation: false
    },
    successCriteria: "Clarify user command before execution"
  };
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeParsedIntent(userCommand: string, parsed: Partial<IntentParseResult>, source: "deterministic" | "llm"): IntentParseResult {
  const baseIntent = defaultUnknownIntent(userCommand);
  const incomingIntent = (parsed.intent ?? {}) as Partial<IntentSpec>;
  const normalizedIntent: IntentSpec = {
    intentType: incomingIntent.intentType ?? "unknown",
    objective: incomingIntent.objective ?? userCommand,
    preferredSurface: incomingIntent.preferredSurface,
    targetApp: incomingIntent.targetApp,
    targetWindow: incomingIntent.targetWindow,
    domainPolicyApplied: incomingIntent.domainPolicyApplied,
    targets: {
      app: incomingIntent.targets?.app,
      url: incomingIntent.targets?.url,
      element: incomingIntent.targets?.element,
      text: incomingIntent.targets?.text,
      hotkey: incomingIntent.targets?.hotkey,
      coords: incomingIntent.targets?.coords
    },
    constraints: {
      forbiddenTerms: incomingIntent.constraints?.forbiddenTerms ?? [...DEFAULT_FORBIDDEN_TERMS],
      requiresConfirmation: Boolean(incomingIntent.constraints?.requiresConfirmation),
      maxSteps: incomingIntent.constraints?.maxSteps
    },
    successCriteria: incomingIntent.successCriteria ?? baseIntent.successCriteria
  };

  return {
    intent: normalizedIntent,
    confidence: clampConfidence(Number(parsed.confidence ?? 0)),
    clarificationNeeded: Boolean(parsed.clarificationNeeded),
    clarificationQuestion: parsed.clarificationQuestion,
    source
  };
}

export class IntentParser {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly minConfidence: number;
  private readonly onUsage?: (event: IntentParserUsageEvent) => void;

  constructor(openai: OpenAI, model: string, minConfidence: number, onUsage?: (event: IntentParserUsageEvent) => void) {
    this.openai = openai;
    this.model = model;
    this.minConfidence = clampConfidence(minConfidence);
    this.onUsage = onUsage;
  }

  async parseIntent(userCommand: string): Promise<IntentParseResult> {
    const deterministic = this.deterministicParse(userCommand);
    if (deterministic && deterministic.confidence >= this.minConfidence && !deterministic.clarificationNeeded) {
      return this.normalizeIntent(userCommand, deterministic, "deterministic");
    }

    try {
      const llm = await this.llmParse(userCommand);
      const normalized = this.normalizeIntent(userCommand, llm, "llm");
      if (normalized.confidence < this.minConfidence) {
        return {
          ...normalized,
          clarificationNeeded: true,
          clarificationQuestion:
            normalized.clarificationQuestion ??
            "Please clarify your command with a clearer verb and target, for example: 'open chrome and go to github.com'."
        };
      }
      return normalized;
    } catch {
      return this.normalizeIntent(
        userCommand,
        {
          intent: defaultUnknownIntent(userCommand),
          confidence: 0,
          clarificationNeeded: true,
          clarificationQuestion:
            "I could not confidently interpret your command. Try: 'open <app>', 'go to <url>', 'click <element>', 'type \"text\" in <field>'."
        },
        "llm"
      );
    }
  }

  deterministicParse(userCommand: string): IntentParseResult | null {
    const raw = userCommand.trim();
    const text = raw.toLowerCase();

    if (!raw) {
      return null;
    }

    const urlMatch = raw.match(/\bhttps?:\/\/[^\s]+|\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/i);
    const emailMatch = raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    const coordMatch = raw.match(/(\d{1,4})\s*[,x]\s*(\d{1,4})/i);
    const quotedTextMatch = raw.match(/"([^"]+)"/);
    const hotkeyMatch = raw.match(/\b(?:ctrl|alt|shift|cmd|win)\s*\+\s*[a-z0-9]+\b/gi);

    if (/\b(stop|cancel|abort)\b/.test(text)) {
      return {
        intent: {
          intentType: "stop",
          objective: "Stop the running task safely",
          preferredSurface: "desktop",
          targets: {},
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Current automation loop stops"
        },
        confidence: 0.98,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\bgmail\b/.test(text) && /\b(compose|email|mail)\b/.test(text) && emailMatch?.[0]) {
      const recipient = emailMatch[0].trim();
      const body = quotedTextMatch?.[1]?.trim() ?? "";
      const composeUrl =
        `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(recipient)}` +
        `&body=${encodeURIComponent(body)}`;
      return {
        intent: {
          intentType: "multi_step_goal",
          objective: raw,
          preferredSurface: "browser",
          targetApp: "chrome",
          domainPolicyApplied: true,
          targets: {
            app: "chrome",
            url: composeUrl,
            element: /\bsend\b/.test(text) ? "Send" : undefined,
            text: body
          },
          constraints: {
            forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS],
            requiresConfirmation: false
          },
          successCriteria: /\bsend\b/.test(text)
            ? "Gmail compose is opened with recipient/body and send action is attempted."
            : "Gmail compose is opened with recipient/body prefilled."
        },
        confidence: 0.93,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\b(open)\b/.test(text) && (/\b(go to|visit|navigate)\b/.test(text) || urlMatch)) {
      const appMatch = raw.match(/\bopen\s+([a-z0-9 ._-]+)/i);
      return {
        intent: {
          intentType: "multi_step_goal",
          objective: raw,
          preferredSurface: "browser",
          targetApp: appMatch?.[1]?.trim(),
          domainPolicyApplied: Boolean(urlMatch),
          targets: {
            app: appMatch?.[1]?.trim(),
            url: urlMatch ? urlMatch[0].trim() : undefined
          },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Requested app opens and target destination is reached"
        },
        confidence: 0.9,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\b(go to|visit|navigate)\b/.test(text) && urlMatch) {
      return {
        intent: {
          intentType: "navigate_url",
          objective: raw,
          preferredSurface: "browser",
          domainPolicyApplied: true,
          targets: { url: urlMatch[0].trim() },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Target URL is opened in an active browser"
        },
        confidence: 0.94,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\b(open)\b/.test(text) && !urlMatch) {
      const appMatch = raw.match(/\bopen\s+([a-z0-9 ._-]+)/i);
      return {
        intent: {
          intentType: "open_app",
          objective: raw,
          preferredSurface: appMatch?.[1]?.toLowerCase().includes("chrome") ? "browser" : "desktop",
          targetApp: appMatch?.[1]?.trim(),
          targets: { app: appMatch?.[1]?.trim() },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Application is launched and visible"
        },
        confidence: appMatch?.[1] ? 0.88 : 0.62,
        clarificationNeeded: !appMatch?.[1],
        clarificationQuestion: appMatch?.[1] ? undefined : "Which application should I open?",
        source: "deterministic"
      };
    }

    if (/\b(click)\b/.test(text)) {
      return {
        intent: {
          intentType: "click_element",
          objective: raw,
          preferredSurface: /tab|browser|chrome|url|website|page/i.test(raw) ? "browser" : "desktop",
          targets: coordMatch
            ? { coords: { x: Number(coordMatch[1]), y: Number(coordMatch[2]) } }
            : { element: raw.replace(/^\s*click\s*/i, "").trim() || undefined },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Requested click interaction is completed"
        },
        confidence: coordMatch ? 0.96 : 0.78,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\b(type|enter)\b/.test(text)) {
      return {
        intent: {
          intentType: "type_text",
          objective: raw,
          preferredSurface: /tab|browser|chrome|url|website|page/i.test(raw) ? "browser" : "desktop",
          targets: {
            text: quotedTextMatch?.[1]?.trim()
          },
          constraints: {
            forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS],
            requiresConfirmation: /\bpassword|token|api key|secret\b/i.test(text)
          },
          successCriteria: "Requested text is entered in target input"
        },
        confidence: quotedTextMatch?.[1] ? 0.9 : 0.58,
        clarificationNeeded: !quotedTextMatch?.[1],
        clarificationQuestion: quotedTextMatch?.[1] ? undefined : "What exact text should be typed? Use quotes for clarity.",
        source: "deterministic"
      };
    }

    if (/\b(press|hotkey|shortcut)\b/.test(text) && hotkeyMatch?.length) {
      const keys = hotkeyMatch[0]
        .toLowerCase()
        .split("+")
        .map((k) => k.trim())
        .filter(Boolean);
      return {
        intent: {
          intentType: "press_hotkey",
          objective: raw,
          preferredSurface: "desktop",
          targets: { hotkey: keys },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Requested hotkey has been pressed"
        },
        confidence: 0.95,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    if (/\bscroll\b/.test(text)) {
      const dir = /\bup\b/.test(text) ? "up" : /\bdown\b/.test(text) ? "down" : undefined;
      return {
        intent: {
          intentType: "scroll",
          objective: raw,
          preferredSurface: /browser|chrome|website|page/i.test(raw) ? "browser" : "desktop",
          targets: { element: dir },
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Screen view has been scrolled in requested direction"
        },
        confidence: dir ? 0.88 : 0.67,
        clarificationNeeded: !dir,
        clarificationQuestion: dir ? undefined : "Should I scroll up or down?",
        source: "deterministic"
      };
    }

    if (/\bwait\b/.test(text)) {
      return {
        intent: {
          intentType: "wait",
          objective: raw,
          preferredSurface: "desktop",
          targets: {},
          constraints: { forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS], requiresConfirmation: false },
          successCriteria: "Wait period completes"
        },
        confidence: 0.9,
        clarificationNeeded: false,
        source: "deterministic"
      };
    }

    return null;
  }

  async llmParse(userCommand: string): Promise<IntentParseResult> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content: [
            "You are an intent parser for a desktop automation agent.",
            "Return ONLY valid JSON with this schema:",
            "{",
            '  "intent": {',
            '    "intentType": "open_app|navigate_url|click_element|type_text|press_hotkey|scroll|wait|stop|multi_step_goal|unknown",',
            '    "objective": "string",',
            '    "preferredSurface": "desktop|browser (optional)",',
            '    "targetApp": "string (optional)",',
            '    "targetWindow": "string (optional)",',
            '    "domainPolicyApplied": "boolean (optional)",',
            '    "targets": {"app?":"string","url?":"string","element?":"string","text?":"string","hotkey?":["string"],"coords?":{"x":number,"y":number}},',
            '    "constraints": {"forbiddenTerms":["string"],"requiresConfirmation":boolean,"maxSteps?":number},',
            '    "successCriteria": "string"',
            "  },",
            '  "confidence": number,',
            '  "clarificationNeeded": boolean,',
            '  "clarificationQuestion": "string (optional)"',
            "}",
            "No markdown, no prose."
          ].join("\n")
        },
        { role: "user", content: userCommand }
      ]
    });

    const promptTokens = normalizeTokenCount(response.usage?.prompt_tokens);
    const completionTokens = normalizeTokenCount(response.usage?.completion_tokens);
    const totalTokens = normalizeTokenCount(
      response.usage?.total_tokens ?? promptTokens + completionTokens
    );
    if (this.onUsage && (promptTokens > 0 || completionTokens > 0 || totalTokens > 0)) {
      this.onUsage({
        model: this.model,
        promptTokens,
        completionTokens,
        totalTokens
      });
    }

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = extractJson(content) as Partial<IntentParseResult> | null;
    if (!parsed) {
      throw new Error("Intent parser returned non-JSON response");
    }
    return this.normalizeIntent(userCommand, parsed, "llm");
  }

  normalizeIntent(userCommand: string, parsed: Partial<IntentParseResult>, source: "deterministic" | "llm"): IntentParseResult {
    const normalized = normalizeParsedIntent(userCommand, parsed, source);
    if (!normalized.intent.constraints.forbiddenTerms.length) {
      normalized.intent.constraints.forbiddenTerms = [...DEFAULT_FORBIDDEN_TERMS];
    }
    if (normalized.confidence < this.minConfidence && !normalized.clarificationNeeded) {
      normalized.clarificationNeeded = true;
      normalized.clarificationQuestion =
        normalized.clarificationQuestion ??
        "Please rephrase with a clear verb and target, for example: 'open chrome and go to github.com'.";
    }
    return normalized;
  }
}
