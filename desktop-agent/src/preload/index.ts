import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/constants";
import type { AgentAction, AgentState, ChatMessage, ScheduledTask, TaskHistoryRecord } from "../shared/types";

const api = {
  startTask: (task: string) => ipcRenderer.invoke(IPC_CHANNELS.START_TASK, task),
  stopTask: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_TASK),
  confirmAction: (confirmationId: string, approved: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIRM_ACTION, { confirmationId, approved }),
  openDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_DASHBOARD),
  openTaskEditor: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_TASK_EDITOR),
  minimizeChat: () => ipcRenderer.invoke(IPC_CHANNELS.APP_MINIMIZE),
  closeChat: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CLOSE),
  getHistory: (): Promise<TaskHistoryRecord[]> => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  getScheduledTasks: (): Promise<ScheduledTask[]> => ipcRenderer.invoke(IPC_CHANNELS.GET_SCHEDULED),
  createScheduledTask: (payload: { name: string; cron: string; task: string }): Promise<ScheduledTask[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_SCHEDULED, payload),
  deleteScheduledTask: (id: number): Promise<ScheduledTask[]> => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SCHEDULED, id),
  onAgentMessage: (handler: (message: ChatMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ChatMessage) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.AGENT_MESSAGE, wrapped);
    return () => ipcRenderer.off(IPC_CHANNELS.AGENT_MESSAGE, wrapped);
  },
  onAgentState: (handler: (state: Partial<AgentState>) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Partial<AgentState>) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.AGENT_STATE, wrapped);
    return () => ipcRenderer.off(IPC_CHANNELS.AGENT_STATE, wrapped);
  },
  onConfirmation: (handler: (payload: { confirmationId: string; action: AgentAction }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { confirmationId: string; action: AgentAction }) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.AGENT_CONFIRMATION, wrapped);
    return () => ipcRenderer.off(IPC_CHANNELS.AGENT_CONFIRMATION, wrapped);
  }
};

contextBridge.exposeInMainWorld("desktopApi", api);

export type DesktopApi = typeof api;
