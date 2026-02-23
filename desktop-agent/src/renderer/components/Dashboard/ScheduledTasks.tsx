import { useState } from "react";
import type { ScheduledTask } from "@shared/types";

interface ScheduledTasksProps {
  items: ScheduledTask[];
  onCreate: (payload: { name: string; cron: string; task: string }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function ScheduledTasks({ items, onCreate, onDelete }: ScheduledTasksProps) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 * * * *");
  const [task, setTask] = useState("");

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <h3 className="text-sm font-semibold">Scheduled Tasks</h3>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <input className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="Cron" />
        <input className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Task" />
      </div>
      <button
        className="mt-2 rounded bg-sky-600 px-3 py-1 text-xs hover:bg-sky-500"
        onClick={() => {
          if (!name.trim() || !task.trim()) return;
          void onCreate({ name: name.trim(), cron: cron.trim(), task: task.trim() });
          setName("");
          setTask("");
        }}
      >
        Create
      </button>
      <div className="mt-3 space-y-2 max-h-48 overflow-auto">
        {items.map((item) => (
          <div key={item.id} className="rounded border border-slate-700 p-2 flex items-center justify-between">
            <div>
              <div className="text-xs">{item.name}</div>
              <div className="text-[11px] text-slate-400">{item.cron}</div>
            </div>
            <button className="text-xs rounded bg-rose-700 px-2 py-1 hover:bg-rose-600" onClick={() => void onDelete(item.id)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
