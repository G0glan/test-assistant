import { create } from "zustand";
import type { ChatMessage } from "@shared/types";

interface ChatStore {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  addMessage: (msg: ChatMessage) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  input: "",
  setInput: (input) => set({ input }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  clear: () => set({ messages: [] })
}));
