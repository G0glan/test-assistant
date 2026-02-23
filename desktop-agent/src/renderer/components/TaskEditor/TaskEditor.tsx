import { useState } from "react";
import StepBuilder from "./StepBuilder";

export default function TaskEditor() {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 * * * *");
  const [task, setTask] = useState("");
  const [info, setInfo] = useState("");

  const save = async () => {
    if (!name.trim() || !task.trim()) {
      setInfo("Name and task are required.");
      return;
    }
    await window.desktopApi.createScheduledTask({ name: name.trim(), cron: cron.trim(), task: task.trim() });
    setInfo("Task saved.");
    setName("");
    setTask("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-4">
      <h1 className="text-lg font-semibold">Task Editor</h1>
      <div className="grid gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm" />
        <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="Cron expression" className="rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm" />
        <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="Task instructions" rows={4} className="rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm" />
      </div>
      <StepBuilder />
      <button onClick={() => void save()} className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500">
        Save Task
      </button>
      {info ? <div className="text-xs text-slate-300">{info}</div> : null}
    </div>
  );
}
