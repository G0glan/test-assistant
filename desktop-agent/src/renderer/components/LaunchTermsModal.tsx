import { useState } from "react";

interface LaunchTermsModalProps {
  open: boolean;
  onConfirm: (dontShowAgain: boolean) => void;
}

export const LAUNCH_TERMS_KEY = "desktop_agent_terms_ack_v1";

export default function LaunchTermsModal({ open, onConfirm }: LaunchTermsModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(true);

  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 no-drag">
      <div className="w-[360px] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100">Command Terms Guide</h2>
        <p className="mt-2 text-xs text-slate-300">
          Use clear verbs and targets. Natural language is supported, but these patterns are preferred:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-slate-200">
          <li>`open &lt;app&gt;`</li>
          <li>`go to &lt;url&gt;`</li>
          <li>`click &lt;element&gt;` or `click 200,300`</li>
          <li>`type &quot;text&quot; in &lt;field&gt;`</li>
          <li>`press ctrl+s`</li>
          <li>`scroll up` / `scroll down`</li>
          <li>`stop`</li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don&apos;t show again
        </label>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => onConfirm(dontShowAgain)}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
