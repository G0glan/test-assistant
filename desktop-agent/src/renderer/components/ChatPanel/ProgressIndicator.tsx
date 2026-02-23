export default function ProgressIndicator({ step, total }: { step: number; total: number }) {
  const safeTotal = Math.max(1, total);
  const width = Math.min(100, (step / safeTotal) * 100);
  return (
    <div className="px-4 py-2 bg-slate-900/60">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>Step progress</span>
        <span>
          {step}/{safeTotal}
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
