/** Install the current tables whose meaning is owned by Workers. */
export async function initializeWorkerSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS workers (
      session_id        TEXT PRIMARY KEY,
      worker_type       TEXT NOT NULL
        CHECK (worker_type IN ('session', 'file', 'app', 'channel')),
      parent_session_id TEXT,
      file_path         TEXT,
      app_id            TEXT,
      channel_id        TEXT,
      ephemeral         INTEGER NOT NULL
        CHECK (ephemeral IN (0, 1)),
      name              TEXT,
      metadata          TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
      CHECK (
        (
          worker_type = 'app'
          AND parent_session_id IS NULL
          AND file_path IS NULL
          AND app_id IS NOT NULL
          AND channel_id IS NULL
        )
        OR
        (
          worker_type = 'channel'
          AND parent_session_id IS NULL
          AND file_path IS NULL
          AND app_id IS NULL
          AND channel_id IS NOT NULL
        )
        OR
        (
          worker_type = 'session'
          AND parent_session_id IS NOT NULL
          AND file_path IS NULL
          AND app_id IS NULL
          AND channel_id IS NULL
        )
        OR
        (
          worker_type = 'file'
          AND parent_session_id IS NOT NULL
          AND file_path IS NOT NULL
          AND app_id IS NULL
          AND channel_id IS NULL
        )
      )
    );

    CREATE INDEX IF NOT EXISTS idx_workers_parent_session_id
      ON workers(parent_session_id);

    CREATE INDEX IF NOT EXISTS idx_workers_app_id
      ON workers(app_id);

    CREATE INDEX IF NOT EXISTS idx_workers_channel_id
      ON workers(channel_id, session_id);
  `);
}
