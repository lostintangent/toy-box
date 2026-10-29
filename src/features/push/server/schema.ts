export async function initializePushSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS push_registrations (
      registration_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production'))
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      registration_id TEXT NOT NULL REFERENCES push_registrations(registration_id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      token TEXT,
      started_at REAL,
      PRIMARY KEY (registration_id, topic)
    );
  `);
}
