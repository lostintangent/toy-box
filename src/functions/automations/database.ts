import { computeNextAutomationRunAt } from "@/lib/automation/cron";
import { createAutomationId } from "@/lib/automation/id";
import { parseSerializedModelConfiguration } from "@/lib/modelConfiguration";
import type { Automation, AutomationOptions } from "@/types";

const DUE_AUTOMATION_RETRY_DELAY_MS = 60_000;

export class AutomationDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async list(): Promise<Automation[]> {
    const rows = await this.db<AutomationRow[]>`
      SELECT * FROM automations ORDER BY updated_at DESC
    `;
    return readValidAutomations(rows, "list");
  }

  async get(automationId: string): Promise<Automation | null> {
    const [row] = await this.db<AutomationRow[]>`
      SELECT * FROM automations WHERE id = ${automationId}
    `;
    return row ? automationFromRow(row) : null;
  }

  async create(input: AutomationOptions): Promise<Automation> {
    const now = new Date();
    const nowIso = now.toISOString();
    const nextRunAt = computeNextAutomationRunAt(input.cron, now).toISOString();
    const id = createAutomationId();
    const values = serializeOptions(input);

    await this.db`
      INSERT INTO automations (id, title, prompt, model_configuration, cron, cwd, created_at, updated_at, next_run_at)
      VALUES (${id}, ${values.title}, ${values.prompt}, ${values.model}, ${values.cron}, ${values.cwd}, ${nowIso}, ${nowIso}, ${nextRunAt})
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
    const values = serializeOptions(input);

    const [row] = await this.db<AutomationRow[]>`
      UPDATE automations
      SET title = ${values.title}, prompt = ${values.prompt}, cron = ${values.cron},
          model_configuration = ${values.model},
          cwd = ${values.cwd}, updated_at = ${nowIso}, next_run_at = ${nextRunAt}
      WHERE id = ${automationId}
      RETURNING *
    `;
    return row ? automationFromRow(row) : null;
  }

  async delete(automationId: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      DELETE FROM automations WHERE id = ${automationId} RETURNING id
    `;
    return rows.length > 0;
  }

  async recordRunFinish(automationId: string, finishedAt: Date): Promise<void> {
    const finishedAtIso = finishedAt.toISOString();
    await this.db`
      UPDATE automations
      SET last_run_at = ${finishedAtIso}, updated_at = ${finishedAtIso}
      WHERE id = ${automationId}
    `;
  }

  async claimDue(): Promise<Automation[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    const fallbackNextRunAt = new Date(now.getTime() + DUE_AUTOMATION_RETRY_DELAY_MS).toISOString();
    return this.db.begin("IMMEDIATE", async (db) => {
      const rows = await db<AutomationRow[]>`
        SELECT * FROM automations WHERE next_run_at <= ${nowIso} ORDER BY next_run_at ASC
      `;

      for (const row of rows) {
        let nextRunAt = fallbackNextRunAt;
        try {
          nextRunAt = computeNextAutomationRunAt(row.cron, now).toISOString();
        } catch (error) {
          console.error(`Failed to reschedule automation ${row.id}:`, error);
        }
        await db`UPDATE automations SET next_run_at = ${nextRunAt} WHERE id = ${row.id}`;
        row.next_run_at = nextRunAt;
      }

      return readValidAutomations(rows, "claim");
    });
  }
}

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
  cwd: string | null;
};

function serializeOptions(input: AutomationOptions) {
  return {
    ...input,
    model: JSON.stringify(input.model),
    cwd: input.cwd ?? null,
  };
}

function automationFromRow(row: AutomationRow): Automation {
  const model = parseSerializedModelConfiguration(row.model_configuration);
  if (!model?.name) {
    throw new Error("Automation model configuration is missing a model");
  }

  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    model,
    cron: row.cron,
    cwd: row.cwd ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? undefined,
  };
}

function readValidAutomations(rows: AutomationRow[], source: string): Automation[] {
  const automations: Automation[] = [];
  for (const row of rows) {
    try {
      automations.push(automationFromRow(row));
    } catch (error) {
      console.error(`Skipping invalid automation row ${row.id} during ${source}:`, error);
    }
  }
  return automations;
}
