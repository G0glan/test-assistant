interface SystemTrayProps {
  onOpenDashboard: () => void;
  onOpenTaskEditor: () => void;
}

export default function SystemTray({ onOpenDashboard, onOpenTaskEditor }: SystemTrayProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <button onClick={onOpenDashboard} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">
        Dashboard
      </button>
      <button onClick={onOpenTaskEditor} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">
        Task Editor
      </button>
    </div>
  );
}
