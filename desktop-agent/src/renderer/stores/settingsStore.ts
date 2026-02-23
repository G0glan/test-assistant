import { create } from "zustand";

interface SettingsStore {
  voiceEnabled: boolean;
  confirmationsEnabled: boolean;
  launchTermsOpen: boolean;
  setVoiceEnabled: (value: boolean) => void;
  setConfirmationsEnabled: (value: boolean) => void;
  setLaunchTermsOpen: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  voiceEnabled: true,
  confirmationsEnabled: true,
  launchTermsOpen: false,
  setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
  setConfirmationsEnabled: (confirmationsEnabled) => set({ confirmationsEnabled }),
  setLaunchTermsOpen: (launchTermsOpen) => set({ launchTermsOpen })
}));
