import path from "node:path";
import { BrowserWindow } from "electron";

function resolvePreloadPath(): string {
  return path.join(__dirname, "../../preload/index.js");
}

function resolveRendererEntry(): string {
  return path.join(__dirname, "../../renderer/index.html");
}

export function createTaskEditorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 560,
    minHeight: 420,
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
    void win.loadURL(`${devServer}?view=task-editor`);
  } else {
    void win.loadFile(resolveRendererEntry(), { query: { view: "task-editor" } });
  }
  win.once("ready-to-show", () => win.show());
  return win;
}
