import path from "node:path";
import { BrowserWindow } from "electron";

function resolvePreloadPath(): string {
  return path.join(__dirname, "../../preload/index.js");
}

function resolveRendererEntry(): string {
  return path.join(__dirname, "../../renderer/index.html");
}

export function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void win.loadURL(`${devServer}?view=dashboard`);
  } else {
    void win.loadFile(resolveRendererEntry(), { query: { view: "dashboard" } });
  }
  win.once("ready-to-show", () => win.show());
  return win;
}
