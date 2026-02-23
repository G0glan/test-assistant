import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { DEFAULT_MAX_STEPS } from "../../shared/constants";
import type {
  AgentAction,
  AgentState,
  ChatMessage,
  IntentParseResult,
  IntentSpec,
  PerceptionSource
} from "../../shared/types";
import { nowIso, parseJsonAction, uid } from "../../shared/utils";
import { insertTaskHistory } from "../database";
import { type ActionResult, executeAction } from "./actionExecutor";
import { isRetryableSemanticError, isSemanticAction, normalizeAction } from "./actionNormalizer";
import { captureScreen, type ScreenFrame } from "./screenCapture";
import { IntentParser, type IntentParserUsageEvent } from "./intentParser";
import { checkSafety, requiresConfirmationForAction } from "./safetyLayer";
import { executeSemanticAction, isSemanticAutomationEnabled } from "./semanticExecutor";

interface AgentOptions {
  maxSteps?: number;
  onUpdate: (update: Partial<AgentState>) => void;
  onMessage: (message: ChatMessage) => void;
  onConfirmation: (action: AgentAction) => Promise<boolean>;
}

interface AgentHistoryEntry {
  screenshot: string;
  action: AgentAction;
  result: string;
}

interface ExecutionEnvelope {
  action: AgentAction;
  result: ActionResult;
  perceptionSource: PerceptionSource;
  debug?: Record<string, unknown>;
  fallbackReason?: string;
}

type TokenMeterPhase = "intent_parser" | "planner" | "screenshot_fallback";

interface TokenBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TokenMeterSnapshot {
  runId: string;
  task: string;
  startedAt: string;
  total: TokenBucket;
  byPhase: Record<TokenMeterPhase, TokenBucket>;
}

function createTokenBucket(): TokenBucket {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
}

function parseTokenCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

export class DesktopAgent {
  private readonly openai: OpenAI;
  private readonly intentParser: IntentParser;
  private readonly plannerModel: string;
  private readonly semanticEnabled: boolean;
  private readonly semanticRetryCount: number;
  private readonly tokenMeterEnabled: boolean;
  private readonly onUpdate: (update: Partial<AgentState>) => void;
  private readonly onMessage: (message: ChatMessage) => void;
  private readonly onConfirmation: (action: AgentAction) => Promise<boolean>;
  private readonly maxSteps: number;
  private abortController: AbortController | null = null;
  private readonly history: AgentHistoryEntry[] = [];
  private state: AgentState = {
    status: "idle",
    currentTask: null,
    stepCount: 0,
    maxSteps: DEFAULT_MAX_STEPS,
    executionMode: "idle",
    fallbackReason: null
  };
  private currentTask = "";
  private currentIntent: IntentSpec | null = null;
  private lastIntentParse: IntentParseResult | null = null;
  private intentActionPlan: AgentAction[] = [];
  private usingIntentActionPlan = false;
  private tokenMeter: TokenMeterSnapshot | null = null;

  constructor(options: AgentOptions) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required");
    }
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.plannerModel = process.env.OPENAI_PLANNER_MODEL || "gpt-4o";
    const intentModel = process.env.OPENAI_INTENT_MODEL || "gpt-4o-mini";
    const minConfidenceRaw = Number(process.env.AGENT_INTENT_MIN_CONFIDENCE ?? "0.65");
    const minConfidence = Number.isFinite(minConfidenceRaw) ? minConfidenceRaw : 0.65;
    const retryRaw = Number(process.env.AGENT_SEMANTIC_RETRY_COUNT ?? "1");
    const meterFlag = (process.env.AGENT_TOKEN_METER_ENABLED ?? "true").trim().toLowerCase();
    this.semanticRetryCount = Number.isFinite(retryRaw) && retryRaw >= 0 ? Math.floor(retryRaw) : 1;
    this.semanticEnabled = isSemanticAutomationEnabled();
    this.tokenMeterEnabled = !["0", "false", "off", "no"].includes(meterFlag);
    this.intentParser = new IntentParser(this.openai, intentModel, minConfidence, (usage) =>
      this.recordTokenUsage("intent_parser", usage.model, usage)
    );
    this.onUpdate = options.onUpdate;
    this.onMessage = options.onMessage;
    this.onConfirmation = options.onConfirmation;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.state.maxSteps = this.maxSteps;
  }

  stopTask(): void {
    this.abortController?.abort();
  }

  runTask(userCommand: string): void {
    void this.runTaskInternal(userCommand);
  }

  private async runTaskInternal(userCommand: string): Promise<void> {
    let runOutcome: "completed" | "aborted" | "error" = "completed";
    this.abortController = new AbortController();
    this.currentTask = userCommand;
    this.history.length = 0;
    this.currentIntent = null;
    this.lastIntentParse = null;
    this.intentActionPlan = [];
    this.usingIntentActionPlan = false;
    this.startTokenMeter(userCommand);
    this.state = {
      ...this.state,
      status: "thinking",
      currentTask: userCommand,
      stepCount: 0,
      executionMode: "idle",
      fallbackReason: null
    };
    this.onUpdate(this.state);
    this.onMessage({
      id: uid("msg"),
      role: "user",
      content: userCommand,
      timestamp: nowIso(),
      type: "text"
    });

    try {
      const intentParse = await this.intentParser.parseIntent(userCommand);
      this.lastIntentParse = intentParse;
      this.currentIntent = intentParse.intent;
      this.state.maxSteps = intentParse.intent.constraints.maxSteps ?? this.maxSteps;
      this.onUpdate({ maxSteps: this.state.maxSteps });

      if (intentParse.intent.intentType === "stop") {
        this.emitSystem("Stop command recognized. Use Stop during a running task to cancel safely.", "text");
        return;
      }

      if (intentParse.clarificationNeeded || intentParse.confidence <= 0) {
        this.emitSystem(
          intentParse.clarificationQuestion ??
            "Please clarify your command with a direct verb and target, for example: 'open chrome and go to github.com'.",
          "text"
        );
        return;
      }

      this.emitSystem(
        `Interpreted command as ${intentParse.intent.intentType} (${Math.round(intentParse.confidence * 100)}% confidence).`,
        "progress"
      );

      const plan = this.buildIntentActionPlan(intentParse.intent);
      const hasSemantic = plan.some((step) => isSemanticAction(step));
      this.usingIntentActionPlan = plan.length > 0 && (!hasSemantic || this.semanticEnabled);
      if (this.usingIntentActionPlan) {
        this.intentActionPlan = plan;
        this.emitSystem(
          `Using intent-first execution plan (${plan.length} step${plan.length === 1 ? "" : "s"}) without screenshot planning.`,
          "progress"
        );
      }

      while (this.state.stepCount < this.state.maxSteps) {
        if (this.abortController.signal.aborted) {
          runOutcome = "aborted";
          this.emitSystem("Task cancelled.", "text");
          break;
        }

        this.state.status = "thinking";
        this.onUpdate({ status: this.state.status });

        let frame: ScreenFrame | null = null;
        let action: AgentAction | null = null;

        if (this.usingIntentActionPlan && this.intentActionPlan.length > 0) {
          action = this.intentActionPlan.shift() ?? null;
        } else if (this.usingIntentActionPlan && this.intentActionPlan.length === 0) {
          this.emitAgent("Intent plan completed.", "text", {
            action: "done",
            parameters: { summary: "Task completed from intent plan." }
          });
          break;
        } else {
          frame = await captureScreen();
          const plannerResponse = await this.requestPlannerAction(frame, userCommand, false);
          const rawAction = parseJsonAction(plannerResponse);
          if (!rawAction) {
            this.emitSystem(plannerResponse || "No action parsed from model response.", "error");
            continue;
          }

          const actionWithIntentDefaults = this.applyIntentDefaults(rawAction);
          const normalized = normalizeAction(actionWithIntentDefaults, frame.width, frame.height);
          if (!normalized.ok || !normalized.action) {
            this.emitSystem(`Planner returned invalid action: ${normalized.error ?? "unknown schema error"}`, "error");
            continue;
          }
          action = normalized.action;

          if (this.semanticEnabled && this.isDisallowedPointerCoordinateAction(action)) {
            this.emitSystem(
              "Planner returned coordinate pointer action outside fallback mode. Rephrase command with semantic target (app/url/element).",
              "error"
            );
            break;
          }
        }

        if (!action) {
          this.emitSystem("No executable action produced.", "error");
          break;
        }

        const proceed = await this.ensureActionAllowed(action, userCommand);
        if (!proceed) {
          if (this.usingIntentActionPlan) {
            break;
          }
          continue;
        }

        this.state.status = "acting";
        this.onUpdate({ status: this.state.status });
        this.emitAgent(this.describeAction(action), "action", action);

        if (action.action === "done") {
          this.emitAgent(String(action.parameters.summary ?? "Task completed."), "text", action);
          break;
        }
        if (action.action === "fail") {
          this.emitSystem(String(action.parameters.reason ?? "Task failed."), "error");
          break;
        }

        const execution = await this.executeWithFallback(action, frame ?? undefined, userCommand);
        action = execution.action;
        const historyResult = execution.fallbackReason
          ? `${execution.result.message} [source=${execution.perceptionSource}; fallback_reason=${execution.fallbackReason}]`
          : `${execution.result.message} [source=${execution.perceptionSource}]`;
        insertTaskHistory(userCommand, action, historyResult);
        this.history.push({ screenshot: frame?.base64 ?? "", action, result: historyResult });
        this.state.stepCount += 1;
        this.state.status = "thinking";
        this.onUpdate({ stepCount: this.state.stepCount, status: this.state.status });

        this.emitSystem(execution.result.message, execution.result.success ? "progress" : "error");
        if (execution.result.success) {
          this.emitExecutionMode(execution.perceptionSource, execution.fallbackReason ?? null);
        }
        if (!execution.result.success && this.usingIntentActionPlan) {
          this.emitSystem("Intent-first execution failed. Stopping without extra screenshot planning.", "error");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (this.state.stepCount >= this.state.maxSteps) {
        this.emitSystem("Maximum steps reached. Task may be incomplete.", "error");
      }
    } catch (error) {
      runOutcome = "error";
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      if (message !== "The operation was aborted") {
        this.emitSystem(`Error: ${message}`, "error");
      }
    } finally {
      if (this.abortController?.signal.aborted) {
        runOutcome = "aborted";
      }
      this.flushTokenMeter(runOutcome);
      this.state = { ...this.state, status: "idle", currentTask: null, executionMode: "idle", fallbackReason: null };
      this.currentIntent = null;
      this.lastIntentParse = null;
      this.intentActionPlan = [];
      this.usingIntentActionPlan = false;
      this.onUpdate(this.state);
    }
  }

  private async ensureActionAllowed(action: AgentAction, task: string): Promise<boolean> {
    if (requiresConfirmationForAction(action, this.currentIntent ?? undefined)) {
      this.state.status = "awaiting_confirmation";
      this.onUpdate({ status: this.state.status });
      const ok = await this.onConfirmation(action);
      if (!ok) {
        this.emitSystem("Action cancelled by user.", "text");
        return false;
      }
    }

    const safety = checkSafety(action, task, this.currentIntent ?? undefined);
    if (!safety.allowed) {
      this.emitSystem(
        `Blocked: ${safety.reason ?? "safety policy"}${safety.reasonCode ? ` (${safety.reasonCode})` : ""}`,
        "error"
      );
      return false;
    }

    return true;
  }

  private async executeWithFallback(action: AgentAction, frame: ScreenFrame | undefined, userCommand: string): Promise<ExecutionEnvelope> {
    if (!(this.semanticEnabled && isSemanticAction(action))) {
      this.emitExecutionMode("coordinate", null);
      const result = await executeAction(action);
      return { action, result, perceptionSource: "coordinate" };
    }

    let lastSemanticMessage = "Semantic execution failed";
    let lastSemanticCode: string | undefined;
    for (let attempt = 0; attempt <= this.semanticRetryCount; attempt += 1) {
      const semantic = await executeSemanticAction(action, this.currentIntent, {
        task: userCommand,
        stepIndex: this.state.stepCount
      });
      this.emitExecutionMode(semantic.perceptionSource, null);
      if (semantic.success) {
        const browserMode =
          semantic.perceptionSource === "browser_shell"
            ? "shell_fallback"
            : semantic.perceptionSource === "chrome_cdp"
              ? "cdp"
              : undefined;
        this.emitAgent(
          `Semantic execution (${semantic.perceptionSource}): ${semantic.message}`,
          "progress",
          action,
          {
            perceptionSource: semantic.perceptionSource,
            browserMode,
            debug: semantic.evidence
          }
        );
        return {
          action,
          result: { success: true, message: semantic.message },
          perceptionSource: semantic.perceptionSource,
          debug: semantic.evidence
        };
      }

      lastSemanticMessage = semantic.message;
      lastSemanticCode = semantic.errorCode;
      const canRetry =
        attempt < this.semanticRetryCount && (semantic.retryable || isRetryableSemanticError(semantic.errorCode));
      if (canRetry) {
        this.emitSystem(`Semantic target unresolved. Retrying (${attempt + 1}/${this.semanticRetryCount})...`, "progress");
        continue;
      }
      break;
    }

    this.emitSystem("Switched to screenshot fallback.", "progress");
    this.emitExecutionMode("screenshot_fallback", lastSemanticMessage);
    const fallbackFrame = frame ?? (await captureScreen());
    const fallback = await this.requestScreenshotFallbackAction(fallbackFrame, userCommand, lastSemanticMessage, action);
    if (!fallback) {
      return {
        action,
        result: {
          success: false,
          message: `Semantic execution failed: ${lastSemanticMessage}${lastSemanticCode ? ` (${lastSemanticCode})` : ""}`
        },
        perceptionSource: "screenshot_fallback",
        fallbackReason: lastSemanticMessage
      };
    }

    const allowed = await this.ensureActionAllowed(fallback, userCommand);
    if (!allowed) {
      return {
        action: fallback,
        result: { success: false, message: "Fallback action blocked by safety or confirmation policy" },
        perceptionSource: "screenshot_fallback",
        fallbackReason: lastSemanticMessage
      };
    }

    this.emitAgent(`Fallback action: ${this.describeAction(fallback)}`, "action", fallback, {
      perceptionSource: "screenshot_fallback",
      fallbackReason: lastSemanticMessage,
      debug: { semanticFailure: lastSemanticMessage, semanticAction: action.action }
    });
    const fallbackResult = await executeAction(fallback);
    return {
      action: fallback,
      result: fallbackResult,
      perceptionSource: "screenshot_fallback",
      fallbackReason: lastSemanticMessage
    };
  }

  private async requestPlannerAction(frame: ScreenFrame, userCommand: string, allowPointerCoordinates: boolean): Promise<string> {
    const response = await this.openai.chat.completions.create(
      {
        model: this.plannerModel,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: this.buildSystemPrompt(frame.width, frame.height, this.currentIntent, allowPointerCoordinates)
          },
          ...this.buildConversationHistory(),
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${frame.base64}`, detail: "high" }
              },
              {
                type: "text",
                text:
                  this.state.stepCount === 0
                    ? `Structured intent:\n${JSON.stringify(this.currentIntent)}\nTask: ${userCommand}\nReturn one best next action.`
                    : `Intent objective: ${this.currentIntent?.objective ?? userCommand}\nContinue from prior result and return one next action.`
              }
            ]
          }
        ]
      },
      { signal: this.abortController?.signal }
    );
    this.recordTokenUsage("planner", this.plannerModel, {
      promptTokens: parseTokenCount(response.usage?.prompt_tokens),
      completionTokens: parseTokenCount(response.usage?.completion_tokens),
      totalTokens: parseTokenCount(response.usage?.total_tokens)
    });

    return response.choices[0]?.message?.content ?? "";
  }

  private async requestScreenshotFallbackAction(
    frame: ScreenFrame,
    userCommand: string,
    failureReason: string,
    semanticAction: AgentAction
  ): Promise<AgentAction | null> {
    const response = await this.openai.chat.completions.create(
      {
        model: this.plannerModel,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: [
              "You are a screenshot fallback planner.",
              "The semantic adapter could not execute the requested action.",
              "Return only one JSON action object.",
              "Allowed fallback actions: click, double_click, right_click, type, hotkey, scroll, move, drag, wait, screenshot, done, fail.",
              "Do not return semantic actions in fallback mode."
            ].join("\n")
          },
          ...this.buildConversationHistory(),
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${frame.base64}`, detail: "high" }
              },
              {
                type: "text",
                text: [
                  `Task: ${userCommand}`,
                  `Intent: ${JSON.stringify(this.currentIntent)}`,
                  `Semantic failure: ${failureReason}`,
                  `Failed semantic action: ${JSON.stringify(semanticAction)}`,
                  "Provide one coordinate-compatible fallback action now."
                ].join("\n")
              }
            ]
          }
        ]
      },
      { signal: this.abortController?.signal }
    );
    this.recordTokenUsage("screenshot_fallback", this.plannerModel, {
      promptTokens: parseTokenCount(response.usage?.prompt_tokens),
      completionTokens: parseTokenCount(response.usage?.completion_tokens),
      totalTokens: parseTokenCount(response.usage?.total_tokens)
    });
    const content = response.choices[0]?.message?.content ?? "";
    const parsed = parseJsonAction(content);
    if (!parsed) return null;
    if (isSemanticAction(parsed)) return null;
    const normalized = normalizeAction(parsed, frame.width, frame.height);
    if (!normalized.ok || !normalized.action) return null;
    return normalized.action;
  }

  private buildSystemPrompt(
    width: number,
    height: number,
    intent: IntentSpec | null,
    allowPointerCoordinates: boolean
  ): string {
    const objective = intent?.objective ?? this.currentTask;
    const success = intent?.successCriteria ?? "User goal is achieved and confirmed.";
    const forbidden = intent?.constraints?.forbiddenTerms?.join(", ") || "captcha bypass, unauthorized access";
    const requiresConfirmation = intent?.constraints?.requiresConfirmation ? "yes" : "no";
    return [
      "# AUTONOMOUS DESKTOP AGENT",
      "You control a Windows desktop by returning exactly one JSON action.",
      "Prefer semantic actions first when possible.",
      allowPointerCoordinates
        ? "Pointer coordinate actions are allowed in this mode."
        : "Pointer coordinate actions are NOT allowed in this mode (click, double_click, right_click, move, drag).",
      "Intent objective:",
      objective,
      "Constraints:",
      `- Forbidden behavior: ${forbidden}`,
      `- Requires confirmation for risky operations: ${requiresConfirmation}`,
      "Termination conditions:",
      `- done when: ${success}`,
      "- fail when target is missing after retry or task is unsafe",
      `Resolution: ${width}x${height}`,
      "Coordinates origin: (0,0) top-left.",
      "Allowed semantic actions: click_element, type_into_element, focus_element, select_option, navigate_url, open_app.",
      allowPointerCoordinates
        ? "Allowed coordinate actions: click, double_click, right_click, move, drag, type, hotkey, scroll, wait, screenshot."
        : "Allowed non-pointer utility actions: type, hotkey, scroll, wait, screenshot.",
      "Also allowed terminal actions: done, fail.",
      "Action schema reminder: {\"action\":\"...\",\"parameters\":{...}}",
      "Output one JSON action object only."
    ].join("\n");
  }

  private applyIntentDefaults(action: AgentAction): AgentAction {
    if (!this.currentIntent) {
      return action;
    }
    const parameters = { ...action.parameters };
    const target = (parameters.target as Record<string, unknown> | undefined) ?? {};

    if (
      action.action === "click_element" &&
      !target.name &&
      !target.selector &&
      !target.elementId &&
      this.currentIntent.targets.coords
    ) {
      return {
        action: "click",
        parameters: {
          x: this.currentIntent.targets.coords.x,
          y: this.currentIntent.targets.coords.y
        }
      };
    }

    if (action.action === "navigate_url" && typeof parameters.url !== "string" && this.currentIntent.targets.url) {
      parameters.url = this.currentIntent.targets.url;
      parameters.target = { ...target, url: this.currentIntent.targets.url };
    }
    if (
      action.action === "open_app" &&
      typeof parameters.app !== "string" &&
      (this.currentIntent.targetApp || this.currentIntent.targets.app)
    ) {
      const app = this.currentIntent.targetApp ?? this.currentIntent.targets.app;
      parameters.app = app;
      parameters.target = { ...target, app };
    }
    if (
      (action.action === "click_element" || action.action === "focus_element" || action.action === "select_option") &&
      !target.name &&
      !target.selector &&
      this.currentIntent.targets.element
    ) {
      parameters.target = { ...target, name: this.currentIntent.targets.element };
    }
    if (action.action === "type_into_element") {
      if (typeof parameters.text !== "string" && this.currentIntent.targets.text) {
        parameters.text = this.currentIntent.targets.text;
      }
      if (!target.name && !target.selector && this.currentIntent.targets.element) {
        parameters.target = { ...target, name: this.currentIntent.targets.element };
      }
    }

    return { ...action, parameters };
  }

  private buildIntentActionPlan(intent: IntentSpec): AgentAction[] {
    const app = intent.targetApp ?? intent.targets.app;
    const url = intent.targets.url;
    const element = intent.targets.element;
    const text = intent.targets.text;
    const coords = intent.targets.coords;

    switch (intent.intentType) {
      case "open_app":
        return app ? [{ action: "open_app", parameters: { app, target: { app, windowTitle: intent.targetWindow } } }] : [];
      case "navigate_url":
        return url ? [{ action: "navigate_url", parameters: { url, target: { url, app, windowTitle: intent.targetWindow } } }] : [];
      case "click_element":
        if (coords) {
          return [{ action: "click", parameters: { x: coords.x, y: coords.y } }];
        }
        return element
          ? [{ action: "click_element", parameters: { target: { name: element, app, windowTitle: intent.targetWindow } } }]
          : [];
      case "type_text":
        if (!text) return [];
        if (element) {
          return [
            {
              action: "type_into_element",
              parameters: { text, target: { name: element, text, app, windowTitle: intent.targetWindow } }
            }
          ];
        }
        return [{ action: "type", parameters: { text } }];
      case "press_hotkey":
        return intent.targets.hotkey?.length ? [{ action: "hotkey", parameters: { keys: intent.targets.hotkey } }] : [];
      case "scroll": {
        const direction = intent.targets.element === "up" ? "up" : "down";
        return [{ action: "scroll", parameters: { direction, amount: 350 } }];
      }
      case "wait":
        return [{ action: "wait", parameters: { seconds: this.extractWaitSeconds(intent.objective) } }];
      case "multi_step_goal": {
        const actions: AgentAction[] = [];
        const sendRequested = /\bsend\b/.test(intent.objective.toLowerCase());
        const gmailCompose = Boolean(url && /mail\.google\.com\/mail\/(?:u\/\d+\/)?\?view=cm/i.test(url));
        if (app && !url) {
          actions.push({ action: "open_app", parameters: { app, target: { app, windowTitle: intent.targetWindow } } });
        }
        if (app && url && !gmailCompose) {
          actions.push({ action: "wait", parameters: { seconds: 0.8 } });
        }
        if (url) {
          actions.push({ action: "navigate_url", parameters: { url, target: { url, app, windowTitle: intent.targetWindow } } });
        }
        if (gmailCompose && sendRequested) {
          actions.push({ action: "wait", parameters: { seconds: 1 } });
          actions.push({
            action: "click_element",
            parameters: { target: { name: "Send", app: app ?? "chrome", windowTitle: "Gmail" } }
          });
        }
        return actions;
      }
      default:
        return [];
    }
  }

  private extractWaitSeconds(objective: string): number {
    const minutesMatch = objective.match(/(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)\b/i);
    if (minutesMatch) {
      return Math.max(0.1, Math.min(30, Number(minutesMatch[1]) * 60));
    }
    const secondsMatch = objective.match(/(\d+(?:\.\d+)?)\s*(s|sec|second|seconds)\b/i);
    if (secondsMatch) {
      return Math.max(0.1, Math.min(30, Number(secondsMatch[1])));
    }
    return 1;
  }

  private isDisallowedPointerCoordinateAction(action: AgentAction): boolean {
    return (
      action.action === "click" ||
      action.action === "double_click" ||
      action.action === "right_click" ||
      action.action === "move" ||
      action.action === "drag"
    );
  }

  private buildConversationHistory(): ChatCompletionMessageParam[] {
    const recent = this.history.slice(-8);
    const messages: ChatCompletionMessageParam[] = [];
    for (const h of recent) {
      messages.push({ role: "assistant", content: JSON.stringify(h.action) });
      messages.push({ role: "user", content: `Action result: ${h.result}` });
    }
    return messages;
  }

  private startTokenMeter(task: string): void {
    if (!this.tokenMeterEnabled) {
      this.tokenMeter = null;
      return;
    }
    const runId = uid("tm");
    this.tokenMeter = {
      runId,
      task: task.slice(0, 300),
      startedAt: nowIso(),
      total: createTokenBucket(),
      byPhase: {
        intent_parser: createTokenBucket(),
        planner: createTokenBucket(),
        screenshot_fallback: createTokenBucket()
      }
    };
    console.info(
      `[token-meter] ${JSON.stringify({
        event: "start",
        runId,
        taskPreview: task.slice(0, 120)
      })}`
    );
  }

  private recordTokenUsage(
    phase: TokenMeterPhase,
    model: string,
    usage: Pick<IntentParserUsageEvent, "promptTokens" | "completionTokens" | "totalTokens">
  ): void {
    if (!this.tokenMeterEnabled || !this.tokenMeter) {
      return;
    }

    const promptTokens = parseTokenCount(usage.promptTokens);
    const completionTokens = parseTokenCount(usage.completionTokens);
    const normalizedTotal = parseTokenCount(usage.totalTokens);
    const totalTokens = normalizedTotal > 0 ? normalizedTotal : promptTokens + completionTokens;
    if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
      return;
    }

    const phaseBucket = this.tokenMeter.byPhase[phase];
    phaseBucket.requests += 1;
    phaseBucket.promptTokens += promptTokens;
    phaseBucket.completionTokens += completionTokens;
    phaseBucket.totalTokens += totalTokens;

    this.tokenMeter.total.requests += 1;
    this.tokenMeter.total.promptTokens += promptTokens;
    this.tokenMeter.total.completionTokens += completionTokens;
    this.tokenMeter.total.totalTokens += totalTokens;

    console.info(
      `[token-meter] ${JSON.stringify({
        event: "usage",
        runId: this.tokenMeter.runId,
        phase,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        cumulativeTotalTokens: this.tokenMeter.total.totalTokens,
        stepIndex: this.state.stepCount
      })}`
    );
  }

  private flushTokenMeter(outcome: "completed" | "aborted" | "error"): void {
    if (!this.tokenMeterEnabled || !this.tokenMeter) {
      return;
    }
    const snapshot = this.tokenMeter;
    this.tokenMeter = null;
    console.info(
      `[token-meter] ${JSON.stringify({
        event: "summary",
        runId: snapshot.runId,
        outcome,
        startedAt: snapshot.startedAt,
        endedAt: nowIso(),
        stepCount: this.state.stepCount,
        total: snapshot.total,
        byPhase: snapshot.byPhase,
        taskPreview: snapshot.task.slice(0, 120)
      })}`
    );
  }

  private describeAction(action: AgentAction): string {
    switch (action.action) {
      case "click":
      case "double_click":
      case "right_click":
      case "move":
        return `${action.action} at (${String(action.parameters.x)}, ${String(action.parameters.y)})`;
      case "type":
        return `type: ${String(action.parameters.text ?? "")}`;
      case "hotkey":
        return `hotkey: ${JSON.stringify(action.parameters.keys ?? [])}`;
      case "scroll":
        return `scroll ${String(action.parameters.direction)} ${String(action.parameters.amount)}`;
      case "drag":
        return `drag from ${JSON.stringify(action.parameters.from)} to ${JSON.stringify(action.parameters.to)}`;
      case "wait":
        return `wait ${String(action.parameters.seconds ?? 1)}s`;
      case "screenshot":
        return "capture screenshot";
      case "done":
        return "task completed";
      case "fail":
        return "task failed";
      case "speak":
        return `speak: ${String(action.parameters.message ?? "")}`;
      case "open_app":
        return `open app: ${String(action.parameters.app ?? action.parameters.target?.app ?? "")}`;
      case "navigate_url":
        return `navigate to ${String(action.parameters.url ?? action.parameters.target?.url ?? "")}`;
      case "click_element":
      case "focus_element":
      case "type_into_element":
      case "select_option":
        return `${action.action}: ${JSON.stringify(action.parameters.target ?? {})}`;
      default:
        return action.action;
    }
  }

  private emitExecutionMode(mode: AgentState["executionMode"], fallbackReason: string | null): void {
    this.state.executionMode = mode;
    this.state.fallbackReason = fallbackReason;
    this.onUpdate({ executionMode: mode, fallbackReason });
  }

  private emitAgent(
    content: string,
    type: ChatMessage["type"],
    action?: AgentAction,
    metadata?: ChatMessage["metadata"]
  ): void {
    this.onMessage({
      id: uid("msg"),
      role: "agent",
      content,
      timestamp: nowIso(),
      type,
      metadata: action ? { action, ...metadata } : metadata
    });
  }

  private emitSystem(content: string, type: ChatMessage["type"]): void {
    this.onMessage({
      id: uid("msg"),
      role: "system",
      content,
      timestamp: nowIso(),
      type
    });
  }
}
