interface InputBarProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
  isRunning: boolean;
  isListening: boolean;
  disabled?: boolean;
}

export default function InputBar(props: InputBarProps) {
  const { input, setInput, onSend, onStop, onToggleVoice, isRunning, isListening, disabled = false } = props;
  return (
    <div className="p-3 bg-slate-900/70 border-t border-slate-700">
      <div className="flex items-center gap-2 no-drag">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSend();
            }
          }}
          disabled={disabled}
          placeholder="Type a command..."
          className="flex-1 bg-slate-800/80 text-slate-100 text-sm px-4 py-2.5 rounded-xl border border-slate-700 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          onClick={onToggleVoice}
          disabled={disabled}
          className={`px-3 py-2.5 rounded-xl text-sm ${isListening ? "bg-rose-600" : "bg-slate-700 hover:bg-slate-600"}`}
        >
          Mic
        </button>
        {isRunning ? (
          <button disabled={disabled} onClick={onStop} className="px-3 py-2.5 bg-rose-600 hover:bg-rose-500 rounded-xl text-sm disabled:cursor-not-allowed disabled:opacity-60">
            Stop
          </button>
        ) : (
          <button disabled={disabled} onClick={onSend} className="px-3 py-2.5 bg-sky-600 hover:bg-sky-500 rounded-xl text-sm disabled:cursor-not-allowed disabled:opacity-60">
            Send
          </button>
        )}
      </div>
    </div>
  );
}
