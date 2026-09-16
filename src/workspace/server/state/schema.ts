/** Install the current tables whose meaning is owned by Workspace. */
export async function initializeWorkspaceSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS settings (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL CHECK (json_valid(value))
    );
  `);
}
