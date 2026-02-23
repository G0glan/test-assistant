import type { AgentAction } from "@shared/types";

export default function ActionPreview({ action }: { action: AgentAction }) {
  return (
    <div className="rounded-lg border border-sky-700/50 bg-sky-900/20 px-3 py-2 text-xs text-sky-200">
      Next action: <span className="font-semibold">{action.action}</span>
      <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-sky-100">{JSON.stringify(action.parameters)}</pre>
    </div>
  );
}
