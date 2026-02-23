import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export interface ChromeDebugTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface ChromeSessionInfo {
  debugPort: number;
  profileDir: string;
  profileMode: "managed" | "system";
  startedByAgent: boolean;
}

interface ChromeVersionInfo {
  webSocketDebuggerUrl?: string;
}

const DEFAULT_DEBUG_PORT = 9222;
const DEFAULT_PROFILE_DIR = "./.agent/chrome-profile";
const DEFAULT_SYSTEM_PROFILE_NAME = "auto";
const STARTUP_TIMEOUT_MS = 12000;

let chromeProcess: ChildProcess | null = null;
let startedByAgent = false;

function resolveProfileDir(): string {
  const envDir = process.env.AGENT_CHROME_PROFILE_DIR || DEFAULT_PROFILE_DIR;
  if (path.isAbsolute(envDir)) {
    return envDir;
  }
  return path.resolve(process.cwd(), envDir);
}

function resolveSystemUserDataDir(): string {
  const envDir = process.env.AGENT_CHROME_SYSTEM_USER_DATA_DIR;
  if (envDir) {
    if (path.isAbsolute(envDir)) {
      return envDir;
    }
    return path.resolve(process.cwd(), envDir);
  }

  const localAppData = process.env.LOCALAPPDATA ?? "";
  return path.join(localAppData, "Google", "Chrome", "User Data");
}

function getProfileMode(): "managed" | "system" {
  const raw = (process.env.AGENT_CHROME_PROFILE_MODE ?? "system").trim().toLowerCase();
  if (raw === "managed") {
    return "managed";
  }
  return "system";
}

function getSystemProfileName(): string {
  const raw = (process.env.AGENT_CHROME_SYSTEM_PROFILE ?? DEFAULT_SYSTEM_PROFILE_NAME).trim();
  if (!raw || raw.toLowerCase() === "auto") {
    return detectLastUsedSystemProfile();
  }
  return raw;
}

function detectLastUsedSystemProfile(): string {
  const localStatePath = path.join(resolveSystemUserDataDir(), "Local State");
  try {
    const raw = fs.readFileSync(localStatePath, "utf8");
    const parsed = JSON.parse(raw) as { profile?: { last_used?: string } };
    const lastUsed = parsed.profile?.last_used;
    if (typeof lastUsed === "string" && lastUsed.trim().length > 0) {
      return lastUsed;
    }
  } catch {
    // no-op
  }
  return "Default";
}

function getChromeDebugPort(): number {
  const parsed = Number(process.env.AGENT_CHROME_DEBUG_PORT ?? DEFAULT_DEBUG_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEBUG_PORT;
}

function getChromeCandidates(): string[] {
  const localApp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "";
  return [
    localApp,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
}

function findChromeExecutable(): string | null {
  for (const candidate of getChromeCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getVersionInfo(port: number): Promise<ChromeVersionInfo | null> {
  try {
    return await fetchJson<ChromeVersionInfo>(`http://127.0.0.1:${port}/json/version`, 1500);
  } catch {
    return null;
  }
}

async function waitForChromeDebugger(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await getVersionInfo(port);
    if (info?.webSocketDebuggerUrl) {
      return;
    }
    await wait(250);
  }
  throw new Error("Chrome remote debugging endpoint did not become ready in time");
}

function launchManagedChrome(port: number, profileDir: string): void {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error("Chrome executable not found. Install Chrome or set AGENT_CHROME_PATH support in code.");
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking"
  ];

  chromeProcess = spawn(chromePath, args, {
    detached: false,
    windowsHide: true,
    stdio: "ignore"
  });
  startedByAgent = true;
  chromeProcess.on("exit", () => {
    chromeProcess = null;
  });
}

function launchSystemChrome(port: number): void {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error("Chrome executable not found. Install Chrome or set AGENT_CHROME_PATH support in code.");
  }

  const userDataDir = resolveSystemUserDataDir();
  const profileName = getSystemProfileName();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileName}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];

  chromeProcess = spawn(chromePath, args, {
    detached: false,
    windowsHide: true,
    stdio: "ignore"
  });
  startedByAgent = true;
  chromeProcess.on("exit", () => {
    chromeProcess = null;
  });
}

export async function ensureChromeSession(): Promise<ChromeSessionInfo> {
  const debugPort = getChromeDebugPort();
  const profileMode = getProfileMode();
  const profileDir = resolveProfileDir();
  const existing = await getVersionInfo(debugPort);
  if (!existing?.webSocketDebuggerUrl) {
    if (profileMode === "managed") {
      launchManagedChrome(debugPort, profileDir);
    } else {
      launchSystemChrome(debugPort);
    }
    try {
      await waitForChromeDebugger(debugPort);
    } catch (error) {
      if (profileMode === "system") {
        throw new Error(
          "Could not attach Chrome in system-profile mode. Close all Chrome windows and retry, or set AGENT_CHROME_PROFILE_MODE=managed."
        );
      }
      throw error;
    }
  }
  return {
    debugPort,
    profileDir,
    profileMode,
    startedByAgent
  };
}

export async function listChromeTargets(): Promise<ChromeDebugTarget[]> {
  const { debugPort } = await ensureChromeSession();
  return await fetchJson<ChromeDebugTarget[]>(`http://127.0.0.1:${debugPort}/json/list`);
}

export async function getActiveTab(): Promise<ChromeDebugTarget | null> {
  const tabs = await listChromeTargets();
  const pageTabs = tabs.filter((t) => t.type === "page");
  return pageTabs[0] ?? null;
}

export async function openTab(url: string): Promise<ChromeDebugTarget> {
  const { debugPort } = await ensureChromeSession();
  const endpoint = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`;
  return await fetchJson<ChromeDebugTarget>(endpoint, 5000);
}

export async function activateTab(tabId: string): Promise<void> {
  const { debugPort } = await ensureChromeSession();
  const endpoint = `http://127.0.0.1:${debugPort}/json/activate/${tabId}`;
  await fetch(endpoint);
}

export async function teardownChromeSession(): Promise<void> {
  if (chromeProcess && startedByAgent) {
    try {
      chromeProcess.kill();
    } catch {
      // no-op
    }
  }
  chromeProcess = null;
  startedByAgent = false;
}

export function openUrlInSystemChrome(url: string): boolean {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    return false;
  }
  const userDataDir = resolveSystemUserDataDir();
  const profileName = getSystemProfileName();
  try {
    spawn(
      chromePath,
      [`--user-data-dir=${userDataDir}`, `--profile-directory=${profileName}`, "--no-first-run", "--no-default-browser-check", url],
      {
        detached: false,
        windowsHide: true,
        stdio: "ignore"
      }
    );
    return true;
  } catch {
    return false;
  }
}
