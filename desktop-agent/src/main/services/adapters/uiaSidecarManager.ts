import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { UiaClient } from "./uiaClient";

const DEFAULT_PORT = 8765;
const STARTUP_TIMEOUT_MS = 15000;

function getPort(): number {
  const parsed = Number(process.env.AGENT_PY_SIDECAR_PORT ?? DEFAULT_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function resolvePythonPath(): string {
  const configured = process.env.AGENT_PY_SIDECAR_PYTHON || ".venv/Scripts/python.exe";
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

function resolveSidecarScriptPath(): string {
  return path.resolve(process.cwd(), "sidecar", "uia_service.py");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class UiaSidecarManager {
  private process: ChildProcess | null = null;
  private startPromise: Promise<boolean> | null = null;
  private readonly client: UiaClient;

  constructor() {
    this.client = new UiaClient(getPort());
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.client.health();
    return Boolean(result.ok);
  }

  async ensureStarted(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    if (await this.isHealthy()) {
      return true;
    }

    if (this.startPromise) {
      return await this.startPromise;
    }

    this.startPromise = this.start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async start(): Promise<boolean> {
    const pythonPath = resolvePythonPath();
    const sidecarPath = resolveSidecarScriptPath();

    if (!fs.existsSync(sidecarPath)) {
      return false;
    }
    if (!fs.existsSync(pythonPath)) {
      return false;
    }

    try {
      this.process = spawn(pythonPath, [sidecarPath, "--port", String(getPort())], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: "ignore"
      });
      this.process.on("exit", () => {
        this.process = null;
      });
    } catch {
      this.process = null;
      return false;
    }

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isHealthy()) {
        return true;
      }
      await delay(300);
    }

    await this.stop();
    return false;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }
    try {
      this.process.kill();
    } catch {
      // no-op
    }
    this.process = null;
  }
}

let sharedManager: UiaSidecarManager | null = null;

export function getUiaSidecarManager(): UiaSidecarManager {
  if (!sharedManager) {
    sharedManager = new UiaSidecarManager();
  }
  return sharedManager;
}
