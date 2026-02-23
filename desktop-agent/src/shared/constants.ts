export const IPC_CHANNELS = {
  START_TASK: "agent:start-task",
  STOP_TASK: "agent:stop-task",
  CONFIRM_ACTION: "agent:confirm-action",
  GET_HISTORY: "history:list",
  GET_SCHEDULED: "schedule:list",
  CREATE_SCHEDULED: "schedule:create",
  DELETE_SCHEDULED: "schedule:delete",
  OPEN_DASHBOARD: "window:open-dashboard",
  OPEN_TASK_EDITOR: "window:open-task-editor",
  APP_MINIMIZE: "window:minimize-chat",
  APP_CLOSE: "window:close-chat",
  AGENT_MESSAGE: "agent:event:message",
  AGENT_STATE: "agent:event:state",
  AGENT_CONFIRMATION: "agent:event:confirmation"
} as const;

export const CHAT_WINDOW = {
  width: 380,
  height: 520,
  minWidth: 320,
  minHeight: 400,
  rightPadding: 20,
  bottomPadding: 20
} as const;

export const DEFAULT_MAX_STEPS = 50;
