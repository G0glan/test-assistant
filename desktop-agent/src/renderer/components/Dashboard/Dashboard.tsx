import { useEffect, useState } from "react";
import type { ScheduledTask, TaskHistoryRecord } from "@shared/types";
import ReplayViewer from "./ReplayViewer";
import ScheduledTasks from "./ScheduledTasks";
import TaskHistory from "./TaskHistory";

export default function Dashboard() {
  const [history, setHistory] = useState<TaskHistoryRecord[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledTask[]>([]);

  const refresh = async () => {
    const [h, s] = await Promise.all([window.desktopApi.getHistory(), window.desktopApi.getScheduledTasks()]);
    setHistory(h);
    setScheduled(s);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-4">
      <h1 className="text-lg font-semibold">Desktop Agent Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TaskHistory items={history} />
        <ScheduledTasks
          items={scheduled}
          onCreate={async (payload) => setScheduled(await window.desktopApi.createScheduledTask(payload))}
          onDelete={async (id) => setScheduled(await window.desktopApi.deleteScheduledTask(id))}
        />
      </div>
      <ReplayViewer latest={history[0] ?? null} />
    </div>
  );
}
