import type { SemanticTarget } from "../../../shared/types";

export interface UiaElementRef {
  elementId: string;
  role?: string;
  name?: string;
  app?: string;
  windowTitle?: string;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
}

export interface UiaClientResult<T = Record<string, unknown>> {
  ok: boolean;
  message?: string;
  errorCode?: string;
  data?: T;
}

interface UiaFindPayload {
  app?: string;
  windowTitle?: string;
  role?: string;
  name?: string;
  elementId?: string;
}

interface UiaActionPayload extends UiaFindPayload {
  text?: string;
}

function getSidecarPort(): number {
  const raw = Number(process.env.AGENT_PY_SIDECAR_PORT ?? "8765");
  return Number.isFinite(raw) && raw > 0 ? raw : 8765;
}

function mapTargetToPayload(target?: SemanticTarget): UiaFindPayload {
  return {
    app: target?.app,
    windowTitle: target?.windowTitle,
    role: target?.role,
    name: target?.name,
    elementId: target?.elementId
  };
}

export class UiaClient {
  private readonly baseUrl: string;

  constructor(port = getSidecarPort()) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<UiaClientResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const payload = (await response.json()) as UiaClientResult<T>;
      if (!response.ok) {
        return {
          ok: false,
          message: payload?.message ?? `HTTP ${response.status}`,
          errorCode: payload?.errorCode ?? "uia_http_error"
        };
      }
      return payload;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "UIA sidecar request failed",
        errorCode: "uia_connection_error"
      };
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<UiaClientResult<{ status: string }>> {
    return this.request<{ status: string }>("/health", "GET");
  }

  find(target?: SemanticTarget): Promise<UiaClientResult<UiaElementRef>> {
    const payload = mapTargetToPayload(target);
    return this.request<UiaElementRef>("/find", "POST", payload);
  }

  click(target?: SemanticTarget): Promise<UiaClientResult<UiaElementRef>> {
    const payload: UiaActionPayload = mapTargetToPayload(target);
    return this.request<UiaElementRef>("/act/click", "POST", payload);
  }

  focus(target?: SemanticTarget): Promise<UiaClientResult<UiaElementRef>> {
    const payload: UiaActionPayload = mapTargetToPayload(target);
    return this.request<UiaElementRef>("/act/focus", "POST", payload);
  }

  type(target: SemanticTarget | undefined, text: string): Promise<UiaClientResult<UiaElementRef>> {
    const payload: UiaActionPayload = {
      ...mapTargetToPayload(target),
      text
    };
    return this.request<UiaElementRef>("/act/type", "POST", payload);
  }
}
