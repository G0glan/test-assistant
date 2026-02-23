import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import type { AgentAction, ScheduledTask, TaskHistoryRecord } from "../../shared/types";

let db: Database.Database | null = null;

function ensureDb(): Database.Database {
  if (db) {
    return db;
  }
  const dbPath = path.join(app.getPath("userData"), "desktop-agent.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      action_json TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      task TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

export function insertTaskHistory(task: string, action: AgentAction, result: string): void {
  const conn = ensureDb();
  conn
    .prepare("INSERT INTO task_history (task, action_json, result) VALUES (?, ?, ?)")
    .run(task, JSON.stringify(action), result);
}

export function listTaskHistory(limit = 100): TaskHistoryRecord[] {
  const conn = ensureDb();
  return conn
    .prepare(
      "SELECT id, task, action_json as actionJson, result, created_at as createdAt FROM task_history ORDER BY id DESC LIMIT ?"
    )
    .all(limit) as TaskHistoryRecord[];
}

export function listScheduledTasks(): ScheduledTask[] {
  const conn = ensureDb();
  return conn
    .prepare("SELECT id, name, cron, task, enabled FROM scheduled_tasks ORDER BY id DESC")
    .all() as ScheduledTask[];
}

export function createScheduledTask(name: string, cron: string, task: string): number {
  const conn = ensureDb();
  const result = conn.prepare("INSERT INTO scheduled_tasks (name, cron, task, enabled) VALUES (?, ?, ?, 1)").run(name, cron, task);
  return Number(result.lastInsertRowid);
}

export function deleteScheduledTask(id: number): void {
  const conn = ensureDb();
  conn.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}
