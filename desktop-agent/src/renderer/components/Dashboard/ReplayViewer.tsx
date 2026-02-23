import type { TaskHistoryRecord } from "@shared/types";

export default function ReplayViewer({ latest }: { latest: TaskHistoryRecord | null }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <h3 className="text-sm font-semibold">Replay Viewer</h3>
      {!latest ? (
        <p className="mt-2 text-xs text-slate-400">No run available.</p>
      ) : (
        <pre className="mt-2 text-xs whitespace-pre-wrap break-all">{latest.actionJson}</pre>
      )}
    </div>
  );
}
