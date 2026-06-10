import type { Database } from "db0";
import { computeNextAutomationRunAt } from "@/lib/automation/cron";
import { parseSerializedModelConfiguration } from "@/lib/modelConfiguration";
import type { Automation, AutomationOptions } from "@/types";

const DUE_AUTOMATION_RETRY_DELAY_MS = 60_000;

type AutomationRow = {
  id: string;
  title: string;
  prompt: string;
  model_configuration: string;
  cron: string;
  created_at: string;
  updated_at: string;
  next_run_at: string;
  last_run_at: string | null;
  last_run_session_id: string | null;
  reuse_session: number;
  cwd: string | null;
};

function mapInputToDatabaseValues(input: AutomationOptions) {
  return {
    ...input,
    modelConfiguration: JSON.stringify(input.modelConfiguration),
    reuseSession: input.reuseSession ? 1 : 0,
    cwd: input.cwd ?? null,
  };
}

function mapRowToAutomation(row: AutomationRow): Automation {
  const modelConfiguration = parseSerializedModelConfiguration(row.model_configuration);
  if (!modelConfiguration?.model) {
    throw new Error("Automation model configuration is missing a model");
  }

  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    modelConfiguration,
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

function mapValidAutomationRows(rows: AutomationRow[], source: string): Automation[] {
  const automations: Automation[] = [];
  for (const row of rows) {
    try {
      automations.push(mapRowToAutomation(row));
    } catch (error) {
      console.error(`Skipping invalid automation row ${row.id} during ${source}:`, error);
    }
  }
  return automations;
}

export class AutomationDatabase {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async list(): Promise<Automation[]> {
    const { rows } = await this.#db.sql`SELECT * FROM automations ORDER BY updated_at DESC`;
    return mapValidAutomationRows(rows as AutomationRow[], "list");
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
    const values = mapInputToDatabaseValues(input);

    await this.#db.sql`
      INSERT INTO automations (id, title, prompt, model_configuration, cron, reuse_session, cwd, created_at, updated_at, next_run_at)
      VALUES (${id}, ${values.title}, ${values.prompt}, ${values.modelConfiguration}, ${values.cron}, ${values.reuseSession}, ${values.cwd}, ${nowIso}, ${nowIso}, ${nextRunAt})
    `;

    return {
      id,
      ...input,
      createdAt: nowIso,
      updatedAt: nowIso,
      nextRunAt,
    };
  }

  async update(automationId: string, input: AutomationOptions): Promise<Automation | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const nextRunAt = computeNextAutomationRunAt(input.cron, now).toISOString();
    const values = mapInputToDatabaseValues(input);

    const result = await this.#db.sql`
      UPDATE automations
      SET title = ${values.title}, prompt = ${values.prompt}, cron = ${values.cron},
          model_configuration = ${values.modelConfiguration},
          reuse_session = ${values.reuseSession}, cwd = ${values.cwd}, updated_at = ${nowIso}, next_run_at = ${nextRunAt}
      WHERE id = ${automationId}
    `;
    if ((result.changes ?? 0) === 0) return null;
    return this.getById(automationId);
  }

  async remove(automationId: string): Promise<boolean> {
    const result = await this.#db.sql`DELETE FROM automations WHERE id = ${automationId}`;
    return (result.changes ?? 0) > 0;
  }

  async updateLastRunSessionId(automationId: string, sessionId: string): Promise<void> {
    await this.#db.sql`
      UPDATE automations
      SET last_run_session_id = ${sessionId}
      WHERE id = ${automationId}
    `;
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
      return mapValidAutomationRows(dueRows, "claim");
    } catch (error) {
      try {
        await this.#db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures if the transaction has already ended.
      }
      throw error;
    }
  }
}
