declare module "screenshot-desktop" {
  interface ScreenshotOptions {
    format?: "png" | "jpg";
    screen?: number;
  }
  export default function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
}

declare module "node-cron" {
  interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }
  interface ScheduledTask {
    stop(): void;
    start(): void;
    destroy(): void;
  }
  const cron: {
    schedule(expression: string, fn: () => void, options?: ScheduleOptions): ScheduledTask;
  };
  export default cron;
}
