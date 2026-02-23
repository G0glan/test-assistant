import type { DesktopApi } from "../preload";

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};
