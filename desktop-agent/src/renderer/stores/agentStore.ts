import { create } from "zustand";
import type { AgentAction, AgentState } from "@shared/types";

interface AgentStore extends AgentState {
  isRunning: boolean;
  pendingConfirmation: { confirmationId: string; action: AgentAction } | null;
  setStatePatch: (patch: Partial<AgentState>) => void;
  setRunning: (running: boolean) => void;
  setPendingConfirmation: (value: { confirmationId: string; action: AgentAction } | null) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  status: "idle",
  currentTask: null,
  stepCount: 0,
  maxSteps: 50,
  executionMode: "idle",
  fallbackReason: null,
  isRunning: false,
  pendingConfirmation: null,
  setStatePatch: (patch) => set((state) => ({ ...state, ...patch })),
  setRunning: (isRunning) => set({ isRunning }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation })
}));
