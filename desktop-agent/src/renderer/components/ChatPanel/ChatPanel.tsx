import { useEffect, useMemo } from "react";
import type { AgentAction } from "@shared/types";
import { useAgent } from "../../hooks/useAgent";
import { useHotkeys } from "../../hooks/useHotkeys";
import { useVoice } from "../../hooks/useVoice";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ConfirmationModal from "../ConfirmationModal";
import LaunchTermsModal, { LAUNCH_TERMS_KEY } from "../LaunchTermsModal";
import ScreenOverlay from "../ScreenOverlay";
import SystemTray from "../SystemTray";
import ActionPreview from "./ActionPreview";
import InputBar from "./InputBar";
import MessageBubble from "./MessageBubble";
import ProgressIndicator from "./ProgressIndicator";

function statusTone(status: string): string {
  if (status === "acting") return "bg-amber-400";
  if (status === "thinking" || status === "awaiting_confirmation") return "bg-sky-400";
  return "bg-slate-400";
}

function modeTone(mode?: string): string {
  if (mode === "chrome_cdp") return "bg-emerald-500/20 text-emerald-200 border-emerald-500/30";
  if (mode === "browser_shell") return "bg-lime-500/20 text-lime-200 border-lime-500/30";
  if (mode === "uia") return "bg-cyan-500/20 text-cyan-200 border-cyan-500/30";
  if (mode === "screenshot_fallback") return "bg-amber-500/20 text-amber-200 border-amber-500/30";
  if (mode === "coordinate") return "bg-slate-500/20 text-slate-200 border-slate-500/30";
  return "bg-slate-700/30 text-slate-300 border-slate-600/40";
}

export default function ChatPanel() {
  const api = window.desktopApi;
  const { startTask, stopTask, submitConfirmation } = useAgent();
  const { messages, input, setInput, addMessage } = useChatStore();
  const { status, stepCount, maxSteps, isRunning, pendingConfirmation, executionMode, fallbackReason } = useAgentStore();
  const launchTermsOpen = useSettingsStore((s) => s.launchTermsOpen);
  const setLaunchTermsOpen = useSettingsStore((s) => s.setLaunchTermsOpen);

  useEffect(() => {
    const acknowledged = localStorage.getItem(LAUNCH_TERMS_KEY) === "true";
    setLaunchTermsOpen(!acknowledged);
  }, [setLaunchTermsOpen]);

  const currentAction = useMemo<AgentAction | null>(() => {
    const last = [...messages].reverse().find((m) => m.metadata?.action);
    return (last?.metadata?.action as AgentAction | undefined) ?? null;
  }, [messages]);

  const sendMessage = async () => {
    if (launchTermsOpen) return;
    const value = input.trim();
    if (!value) return;
    setInput("");
    await startTask(value);
  };

  useHotkeys(sendMessage, stopTask);
  const { isListening, toggleVoice } = useVoice((text) => {
    if (launchTermsOpen) {
      return;
    }
    setInput(text);
    addMessage({
      id: `voice_${Date.now()}`,
      role: "system",
      content: `Voice captured: ${text}`,
      timestamp: new Date().toISOString(),
      type: "text"
    });
  });

  const acknowledgeTerms = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      localStorage.setItem(LAUNCH_TERMS_KEY, "true");
    }
    setLaunchTermsOpen(false);
  };

  return (
    <div className="relative flex flex-col h-screen bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 drag-region">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Desktop Agent</span>
          <span className={`h-2 w-2 rounded-full ${statusTone(status)}`} />
          <span className="text-[11px] text-slate-300">{status}</span>
          <span className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${modeTone(executionMode)}`}>
            {executionMode ?? "idle"}
          </span>
        </div>
        <div className="flex gap-1 no-drag">
          <button onClick={() => api?.minimizeChat()} className="p-1.5 hover:bg-slate-700 rounded text-xs">
            _
          </button>
          <button onClick={() => api?.openDashboard()} className="p-1.5 hover:bg-slate-700 rounded text-xs">
            Grid
          </button>
          <button onClick={() => api?.closeChat()} className="p-1.5 hover:bg-rose-500/80 rounded text-xs">
            X
          </button>
        </div>
      </div>

      <div className="px-4 py-2 bg-slate-900/70 border-b border-slate-700">
        <SystemTray onOpenDashboard={() => void api?.openDashboard()} onOpenTaskEditor={() => void api?.openTaskEditor()} />
        {fallbackReason ? (
          <div className="mt-1 text-[10px] text-amber-300 truncate" title={fallbackReason}>
            Fallback: {fallbackReason}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {currentAction ? <ActionPreview action={currentAction} /> : null}
      </div>

      {isRunning ? <ProgressIndicator step={stepCount} total={maxSteps} /> : null}

      <InputBar
        input={input}
        setInput={setInput}
        onSend={sendMessage}
        onStop={stopTask}
        onToggleVoice={toggleVoice}
        isRunning={isRunning}
        isListening={isListening}
        disabled={launchTermsOpen}
      />

      <ScreenOverlay visible={status === "acting"} />
      <ConfirmationModal
        open={Boolean(pendingConfirmation)}
        action={pendingConfirmation?.action ?? null}
        onApprove={() => pendingConfirmation && submitConfirmation(pendingConfirmation.confirmationId, true)}
        onReject={() => pendingConfirmation && submitConfirmation(pendingConfirmation.confirmationId, false)}
      />
      <LaunchTermsModal open={launchTermsOpen} onConfirm={acknowledgeTerms} />
    </div>
  );
}
