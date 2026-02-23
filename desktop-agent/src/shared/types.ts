export type AgentActionType =
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "hotkey"
  | "scroll"
  | "move"
  | "drag"
  | "wait"
  | "screenshot"
  | "speak"
  | "click_element"
  | "type_into_element"
  | "focus_element"
  | "select_option"
  | "navigate_url"
  | "open_app"
  | "done"
  | "fail";

export interface SemanticTarget {
  elementId?: string;
  role?: string;
  name?: string;
  app?: string;
  windowTitle?: string;
  selector?: string;
  url?: string;
  text?: string;
  coords?: { x: number; y: number };
}

export type PerceptionSource = "uia" | "chrome_cdp" | "browser_shell" | "screenshot_fallback" | "coordinate";

export interface AgentAction {
  action: AgentActionType;
  parameters: Record<string, unknown> & {
    target?: SemanticTarget;
  };
}

export type IntentType =
  | "open_app"
  | "navigate_url"
  | "click_element"
  | "type_text"
  | "press_hotkey"
  | "scroll"
  | "wait"
  | "stop"
  | "multi_step_goal"
  | "unknown";

export interface IntentSpec {
  intentType: IntentType;
  objective: string;
  preferredSurface?: "desktop" | "browser";
  targetApp?: string;
  targetWindow?: string;
  domainPolicyApplied?: boolean;
  targets: {
    app?: string;
    url?: string;
    element?: string;
    text?: string;
    hotkey?: string[];
    coords?: { x: number; y: number };
  };
  constraints: {
    forbiddenTerms: string[];
    requiresConfirmation: boolean;
    maxSteps?: number;
  };
  successCriteria: string;
}

export interface IntentParseResult {
  intent: IntentSpec;
  confidence: number;
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  source: "deterministic" | "llm";
}

export type ChatMessageType = "text" | "action" | "confirmation" | "error" | "progress";
export type ChatMessageRole = "user" | "agent" | "system";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: string;
  type: ChatMessageType;
  metadata?: {
    action?: AgentAction;
    screenshot?: string;
    requiresConfirmation?: boolean;
    perceptionSource?: PerceptionSource;
    browserMode?: "cdp" | "shell_fallback";
    debug?: Record<string, unknown>;
    fallbackReason?: string;
  };
}

export type AgentStatus = "idle" | "thinking" | "acting" | "paused" | "awaiting_confirmation";

export interface AgentState {
  status: AgentStatus;
  currentTask: string | null;
  stepCount: number;
  maxSteps: number;
  executionMode?: "idle" | PerceptionSource;
  fallbackReason?: string | null;
}

export interface TaskHistoryRecord {
  id: number;
  task: string;
  actionJson: string;
  result: string;
  createdAt: string;
}

export interface ScheduledTask {
  id: number;
  name: string;
  cron: string;
  task: string;
  enabled: number;
}
