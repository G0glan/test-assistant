import cron from "node-cron";
import { listScheduledTasks } from "../database";

const jobs = new Map<number, ReturnType<typeof cron.schedule>>();

export function hydrateScheduledTasks(runTask: (task: string) => void): void {
  for (const [id, job] of jobs.entries()) {
    job.stop();
    jobs.delete(id);
  }

  for (const task of listScheduledTasks()) {
    if (!task.enabled) {
      continue;
    }
    const job = cron.schedule(task.cron, () => runTask(task.task), { scheduled: true });
    jobs.set(task.id, job);
  }
}

export function stopAllScheduledTasks(): void {
  for (const job of jobs.values()) {
    job.stop();
  }
  jobs.clear();
}
