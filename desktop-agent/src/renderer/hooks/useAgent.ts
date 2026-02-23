import { useEffect } from "react";
import { nowIso, uid } from "@shared/utils";
import { useAgentStore } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";

export function useAgent() {
  const setStatePatch = useAgentStore((s) => s.setStatePatch);
  const setRunning = useAgentStore((s) => s.setRunning);
  const setPendingConfirmation = useAgentStore((s) => s.setPendingConfirmation);
  const addMessage = useChatStore((s) => s.addMessage);

  useEffect(() => {
    if (!window.desktopApi) {
      addMessage({
        id: uid("msg"),
        role: "system",
        content: "IPC bridge unavailable. The preload script may not be loaded.",
        timestamp: nowIso(),
        type: "error"
      });
      return;
    }
    const offMsg = window.desktopApi.onAgentMessage((msg) => addMessage(msg));
    const offState = window.desktopApi.onAgentState((patch) => {
      setStatePatch(patch);
      if (patch.status) {
        setRunning(patch.status !== "idle");
      }
    });
    const offConfirm = window.desktopApi.onConfirmation((payload) => {
      setPendingConfirmation(payload);
      addMessage({
        id: uid("msg"),
        role: "system",
        content: "Confirmation required before continuing.",
        timestamp: nowIso(),
        type: "confirmation",
        metadata: { action: payload.action, requiresConfirmation: true }
      });
    });
    return () => {
      offMsg();
      offState();
      offConfirm();
    };
  }, [addMessage, setPendingConfirmation, setRunning, setStatePatch]);

  const startTask = async (task: string) => {
    if (!window.desktopApi) {
      return;
    }
    try {
      setRunning(true);
      const response = await window.desktopApi.startTask(task);
      if (!response?.started) {
        setRunning(false);
        addMessage({
          id: uid("msg"),
          role: "system",
          content: `Cannot start task: ${response?.error ?? "unknown error"}`,
          timestamp: nowIso(),
          type: "error"
        });
      }
    } catch (error) {
      setRunning(false);
      addMessage({
        id: uid("msg"),
        role: "system",
        content: `Start task failed: ${error instanceof Error ? error.message : "unknown error"}`,
        timestamp: nowIso(),
        type: "error"
      });
    }
  };

  const stopTask = async () => {
    if (!window.desktopApi) {
      return;
    }
    await window.desktopApi.stopTask();
    setRunning(false);
  };

  const submitConfirmation = async (confirmationId: string, approved: boolean) => {
    if (!window.desktopApi) {
      return;
    }
    await window.desktopApi.confirmAction(confirmationId, approved);
    setPendingConfirmation(null);
  };

  return { startTask, stopTask, submitConfirmation };
}
