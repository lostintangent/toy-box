import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabase, type Database } from "db0";
import type { Connector } from "db0";
import { computeNextAutomationRunAt } from "@/lib/automation/cron";
import type { Automation, AutomationOptions } from "@/types";

const DUE_AUTOMATION_RETRY_DELAY_MS = 60_000;

type AutomationRow = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  cron: string;
  created_at: string;
  updated_at: string;
  next_run_at: string;
  last_run_at: string | null;
  last_run_session_id: string | null;
  reuse_session: number;
  cwd: string | null;
};

function resolveDefaultPath(): string {
  const home = homedir().trim();
  if (home.length > 0) {
    return join(home, ".toy-box", "automations.sqlite");
  }

  return join(process.cwd(), ".toy-box", "automations.sqlite");
}

function mapRowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    model: row.model,
    cron: row.cron,
    reuseSession: row.reuse_session === 1,
    cwd: row.cwd ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunSessionId: row.last_run_session_id ?? undefined,
  };
}

async function createRuntimeSqliteConnector(): Promise<
  (options: { cwd?: string; path?: string; name?: string }) => Connector
> {
  if (typeof Bun !== "undefined") {
    const module = await import("db0/connectors/bun-sqlite");
    return module.default as (options: { cwd?: string; path?: string; name?: string }) => Connector;
  }

  const module = await import("db0/connectors/node-sqlite");
  return module.default as (options: { cwd?: string; path?: string; name?: string }) => Connector;
}

async function createRuntimeDatabase(path: string): Promise<Database> {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const connectorFactory = await createRuntimeSqliteConnector();
  const connectorOptions = path === ":memory:" ? { name: ":memory:" } : { path };
  return createDatabase(connectorFactory(connectorOptions));
}

async function initializeSchema(db: Database, path: string): Promise<void> {
  await db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = NORMAL;");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      cron TEXT NOT NULL,
      cwd TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      last_run_session_id TEXT,
      reuse_session INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_automations_next_run_at
      ON automations(next_run_at);
  `);
}

export class AutomationDatabase {
  #db: Database;

  private constructor(db: Database) {
    this.#db = db;
  }

  static async open(path?: string): Promise<AutomationDatabase> {
    const resolvedPath = path ?? resolveDefaultPath();
    const db = await createRuntimeDatabase(resolvedPath);
    await initializeSchema(db, resolvedPath);
    return new AutomationDatabase(db);
  }

  async list(): Promise<Automation[]> {
    const { rows } = await this.#db.sql`SELECT * FROM automations ORDER BY updated_at DESC`;
    return (rows as AutomationRow[]).map(mapRowToAutomation);
  }

  async getById(automationId: string): Promise<Automation | null> {
    const { rows } = await this.#db.sql`SELECT * FROM automations WHERE id = ${automationId}`;
    const row = (rows as AutomationRow[])[0];
    return row ? mapRowToAutomation(row) : null;
  }

  async create(input: AutomationOptions): Promise<Automation> {
    const now = new Date();
    const nowIso = now.toISOString();
    const nextRunAt = computeNextAutomationRunAt(input.cron, now).toISOString();
    const id = crypto.randomUUID();
    const reuseSession = input.reuseSession ? 1 : 0;
    const cwd = input.cwd ?? null;

    await this.#db.sql`
      INSERT INTO automations (id, title, prompt, model, cron, reuse_session, cwd, created_at, updated_at, next_run_at)
      VALUES (${id}, ${input.title}, ${input.prompt}, ${input.model}, ${input.cron}, ${reuseSession}, ${cwd}, ${nowIso}, ${nowIso}, ${nextRunAt})
    `;

    return {
      id,
      title: input.title,
      prompt: input.prompt,
      model: input.model,
      cron: input.cron,
      reuseSession: input.reuseSession,
      cwd: input.cwd,
      createdAt: nowIso,
      updatedAt: nowIso,
      nextRunAt,
    };
  }

  async update(automationId: string, input: AutomationOptions): Promise<Automation | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const nextRunAt = computeNextAutomationRunAt(input.cron, now).toISOString();
    const reuseSession = input.reuseSession ? 1 : 0;
    const cwd = input.cwd ?? null;

    const result = await this.#db.sql`
      UPDATE automations
      SET title = ${input.title}, prompt = ${input.prompt}, cron = ${input.cron}, model = ${input.model},
          reuse_session = ${reuseSession}, cwd = ${cwd}, updated_at = ${nowIso}, next_run_at = ${nextRunAt}
      WHERE id = ${automationId}
    `;
    if ((result.changes ?? 0) === 0) return null;
    return this.getById(automationId);
  }

  async remove(automationId: string): Promise<boolean> {
    const result = await this.#db.sql`DELETE FROM automations WHERE id = ${automationId}`;
    return (result.changes ?? 0) > 0;
  }

  async updateLastRun(automationId: string, runDate: Date, sessionId: string): Promise<void> {
    const runDateIso = runDate.toISOString();
    await this.#db.sql`
      UPDATE automations
      SET last_run_at = ${runDateIso}, last_run_session_id = ${sessionId}, updated_at = ${runDateIso}
      WHERE id = ${automationId}
    `;
  }

  async claimDue(): Promise<Automation[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    const fallbackNextRunAt = new Date(now.getTime() + DUE_AUTOMATION_RETRY_DELAY_MS).toISOString();
    await this.#db.exec("BEGIN IMMEDIATE");
    try {
      const { rows } = await this.#db.sql`
        SELECT * FROM automations WHERE next_run_at <= ${nowIso} ORDER BY next_run_at ASC
      `;
      const dueRows = rows as AutomationRow[];

      for (const row of dueRows) {
        let nextRunAt = fallbackNextRunAt;
        try {
          nextRunAt = computeNextAutomationRunAt(row.cron, now).toISOString();
        } catch (error) {
          console.error(`Failed to reschedule automation ${row.id}:`, error);
        }
        await this.#db.sql`UPDATE automations SET next_run_at = ${nextRunAt} WHERE id = ${row.id}`;
      }

      await this.#db.exec("COMMIT");
      return dueRows.map(mapRowToAutomation);
    } catch (error) {
      try {
        await this.#db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures if the transaction has already ended.
      }
      throw error;
    }
  }

  close(): void {
    try {
      this.#db.exec("PRAGMA optimize;");
    } catch {
      // Ignore errors (e.g., in-memory databases already disposed).
    }
  }
}
