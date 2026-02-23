import type { AgentAction } from "@shared/types";

interface ConfirmationModalProps {
  open: boolean;
  action: AgentAction | null;
  onApprove: () => void;
  onReject: () => void;
}

export default function ConfirmationModal({ open, action, onApprove, onReject }: ConfirmationModalProps) {
  if (!open || !action) {
    return null;
  }
  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center no-drag z-20">
      <div className="w-[320px] rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="text-sm font-semibold text-slate-100">Confirm action</h3>
        <p className="mt-2 text-xs text-slate-300">The agent requested this action:</p>
        <pre className="mt-2 rounded bg-slate-800 p-2 text-[11px] text-slate-200 break-all">{JSON.stringify(action)}</pre>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onReject} className="rounded px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600">
            Reject
          </button>
          <button onClick={onApprove} className="rounded px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500">
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
