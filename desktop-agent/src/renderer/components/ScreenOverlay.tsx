export default function ScreenOverlay({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return <div className="pointer-events-none absolute inset-0 border-2 border-sky-500/60 rounded-2xl animate-pulse" />;
}
