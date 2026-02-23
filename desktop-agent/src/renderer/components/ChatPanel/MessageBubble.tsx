import type { ChatMessage } from "@shared/types";

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const hasDebug =
    Boolean(message.metadata?.perceptionSource) ||
    Boolean(message.metadata?.browserMode) ||
    Boolean(message.metadata?.fallbackReason) ||
    Boolean(message.metadata?.debug);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] overflow-hidden rounded-xl px-3 py-2 text-sm ${
          isUser ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-100 border border-slate-700"
        }`}
      >
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
        {hasDebug ? (
          <div className="mt-2 rounded border border-slate-700/60 bg-slate-900/50 p-2 text-[10px] text-slate-300">
            {message.metadata?.perceptionSource ? <div>source: {message.metadata.perceptionSource}</div> : null}
            {message.metadata?.browserMode ? <div>browserMode: {message.metadata.browserMode}</div> : null}
            {message.metadata?.fallbackReason ? <div>fallback: {message.metadata.fallbackReason}</div> : null}
            {message.metadata?.debug ? (
              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-400">
                {JSON.stringify(message.metadata.debug, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        <div className="mt-1 text-[10px] text-slate-400">{new Date(message.timestamp).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
