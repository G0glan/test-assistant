import { BrowserWindow, ipcMain, Notification } from "electron";
import { IPC_CHANNELS } from "../../shared/constants";
import type { AgentAction, AgentState, ChatMessage } from "../../shared/types";
import { uid } from "../../shared/utils";
import { createScheduledTask, deleteScheduledTask, listScheduledTasks, listTaskHistory } from "../database";
import { DesktopAgent } from "../services/aiAgent";
import { teardownChromeSession } from "../services/adapters/chromeSession";
import { getUiaSidecarManager } from "../services/adapters/uiaSidecarManager";
import { isSemanticAutomationEnabled } from "../services/semanticExecutor";
import { hydrateScheduledTasks } from "../services/taskScheduler";
import { createDashboardWindow } from "../windows/dashboard";
import { createTaskEditorWindow } from "../windows/taskEditor";

interface HandlerContext {
  chatWindow: BrowserWindow;
}

export function registerIpcHandlers(ctx: HandlerContext): void {
  let agent: DesktopAgent | null = null;
  let dashboardWindow: BrowserWindow | null = null;
  let taskEditorWindow: BrowserWindow | null = null;
  const sidecarManager = getUiaSidecarManager();

  const confirmationResolvers = new Map<string, (approved: boolean) => void>();

  const emitMessage = (message: ChatMessage) => {
    ctx.chatWindow.webContents.send(IPC_CHANNELS.AGENT_MESSAGE, message);
  };
  const emitState = (state: Partial<AgentState>) => {
    ctx.chatWindow.webContents.send(IPC_CHANNELS.AGENT_STATE, state);
  };

  const ensureAgent = (): DesktopAgent => {
    if (!agent) {
      agent = new DesktopAgent({
        onMessage: emitMessage,
        onUpdate: emitState,
        onConfirmation: (action: AgentAction) =>
          new Promise<boolean>((resolve) => {
            const confirmationId = uid("confirm");
            confirmationResolvers.set(confirmationId, resolve);
            ctx.chatWindow.webContents.send(IPC_CHANNELS.AGENT_CONFIRMATION, {
              confirmationId,
              action
            });
          })
      });
    }
    return agent;
  };

  const cleanupSemanticRuntime = async () => {
    await sidecarManager.stop();
    await teardownChromeSession();
  };

  ipcMain.handle(IPC_CHANNELS.START_TASK, async (_event, task: string) => {
    try {
      const runtime = ensureAgent();
      runtime.runTask(task);
      return { started: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start agent";
      emitMessage({
        id: uid("msg"),
        role: "system",
        content: `Cannot start task: ${message}. Add OPENAI_API_KEY in desktop-agent/.env and restart dev mode.`,
        timestamp: new Date().toISOString(),
        type: "error"
      });
      emitState({ status: "idle", currentTask: null });
      return { started: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STOP_TASK, async () => {
    agent?.stopTask();
    return { stopped: true };
  });

  ipcMain.handle(IPC_CHANNELS.CONFIRM_ACTION, async (_event, payload: { confirmationId: string; approved: boolean }) => {
    const resolver = confirmationResolvers.get(payload.confirmationId);
    if (!resolver) {
      return { ok: false };
    }
    confirmationResolvers.delete(payload.confirmationId);
    resolver(Boolean(payload.approved));
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => listTaskHistory(100));
  ipcMain.handle(IPC_CHANNELS.GET_SCHEDULED, async () => listScheduledTasks());

  ipcMain.handle(IPC_CHANNELS.CREATE_SCHEDULED, async (_event, payload: { name: string; cron: string; task: string }) => {
    createScheduledTask(payload.name, payload.cron, payload.task);
    hydrateScheduledTasks((t) => ensureAgent().runTask(t));
    return listScheduledTasks();
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SCHEDULED, async (_event, id: number) => {
    deleteScheduledTask(id);
    hydrateScheduledTasks((t) => ensureAgent().runTask(t));
    return listScheduledTasks();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_DASHBOARD, async () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow();
    } else {
      dashboardWindow.focus();
    }
    return { opened: true };
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TASK_EDITOR, async () => {
    if (!taskEditorWindow || taskEditorWindow.isDestroyed()) {
      taskEditorWindow = createTaskEditorWindow();
    } else {
      taskEditorWindow.focus();
    }
    return { opened: true };
  });

  ipcMain.handle(IPC_CHANNELS.APP_MINIMIZE, async () => {
    ctx.chatWindow.minimize();
    return { minimized: true };
  });

  ipcMain.handle(IPC_CHANNELS.APP_CLOSE, async () => {
    await cleanupSemanticRuntime();
    ctx.chatWindow.close();
    return { closed: true };
  });

  hydrateScheduledTasks((task) => ensureAgent().runTask(task));

  if (isSemanticAutomationEnabled()) {
    void (async () => {
      const ready = await sidecarManager.ensureStarted();
      emitMessage({
        id: uid("msg"),
        role: "system",
        content: ready
          ? "Semantic automation ready (Windows UIA sidecar healthy)."
          : "Semantic automation is enabled but UIA sidecar is unavailable. Using screenshot fallback until sidecar is bootstrapped.",
        timestamp: new Date().toISOString(),
        type: ready ? "progress" : "error"
      });
    })();
  }

  ctx.chatWindow.on("closed", () => {
    void cleanupSemanticRuntime();
  });

  const notifier = new Notification({
    title: "Desktop Agent",
    body: "Desktop Agent is ready."
  });
  notifier.show();
}
