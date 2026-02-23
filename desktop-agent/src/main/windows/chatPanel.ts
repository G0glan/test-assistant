import path from "node:path";
import { BrowserWindow, screen } from "electron";
import { CHAT_WINDOW } from "../../shared/constants";

function resolvePreloadPath(): string {
  return path.join(__dirname, "../../preload/index.js");
}

function resolveRendererEntry(): string {
  return path.join(__dirname, "../../renderer/index.html");
}

export function createChatPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: CHAT_WINDOW.width,
    height: CHAT_WINDOW.height,
    minWidth: CHAT_WINDOW.minWidth,
    minHeight: CHAT_WINDOW.minHeight,
    frame: false,
    transparent: false,
    backgroundColor: "#0f172a",
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    show: false,
        webPreferences: {
            preload: resolvePreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win.setPosition(width - CHAT_WINDOW.width - CHAT_WINDOW.rightPadding, height - CHAT_WINDOW.height - CHAT_WINDOW.bottomPadding);

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(resolveRendererEntry());
  }

  win.once("ready-to-show", () => win.show());
  return win;
}
