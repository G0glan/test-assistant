import type { TaskHistoryRecord } from "@shared/types";

export default function TaskHistory({ items }: { items: TaskHistoryRecord[] }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <h3 className="text-sm font-semibold">Task History</h3>
      <div className="mt-2 max-h-64 overflow-auto space-y-2">
        {items.length === 0 ? <div className="text-xs text-slate-400">No history yet.</div> : null}
        {items.map((item) => (
          <div key={item.id} className="rounded border border-slate-700 p-2">
            <div className="text-xs text-slate-200">{item.task}</div>
            <div className="text-[11px] text-slate-400">{item.result}</div>
            <div className="text-[10px] text-slate-500">{item.createdAt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
