import { useEffect } from "react";

export function useHotkeys(onSubmit: () => void, onStop: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") {
        event.preventDefault();
        onSubmit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onStop, onSubmit]);
}
