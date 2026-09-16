/** Install the current tables whose meaning is owned by Automations. */
export async function initializeAutomationSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model_configuration TEXT NOT NULL,
      cron TEXT NOT NULL,
      cwd TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_automations_next_run_at
      ON automations(next_run_at);
  `);
}
