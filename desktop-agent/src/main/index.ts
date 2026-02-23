import "dotenv/config";
import { app } from "electron";
import { createChatPanelWindow } from "./windows/chatPanel";
import { registerIpcHandlers } from "./ipc/handlers";
import { teardownChromeSession } from "./services/adapters/chromeSession";
import { getUiaSidecarManager } from "./services/adapters/uiaSidecarManager";

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const chatWindow = createChatPanelWindow();
  registerIpcHandlers({ chatWindow });

  app.on("activate", () => {
    if (chatWindow.isDestroyed()) {
      const rebuilt = createChatPanelWindow();
      registerIpcHandlers({ chatWindow: rebuilt });
    }
  });
}

void bootstrap();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void getUiaSidecarManager().stop();
  void teardownChromeSession();
});
