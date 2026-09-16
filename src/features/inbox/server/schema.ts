/** Install the current tables whose meaning is owned by Inbox. */
export async function initializeInboxSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS inbox (
      id         TEXT PRIMARY KEY,
      message    TEXT,
      artifact   TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
