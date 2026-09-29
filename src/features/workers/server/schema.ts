/** Install the current tables whose meaning is owned by Workers. */
export async function initializeWorkerSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS workers (
      session_id        TEXT PRIMARY KEY,
      created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
      worker_type       TEXT NOT NULL
        CHECK (worker_type IN ('session', 'file', 'app', 'channel', 'inbox')),
      parent_session_id TEXT,
      file_path         TEXT,
      app_id            TEXT,
      channel_id        TEXT,
      ephemeral         INTEGER NOT NULL
        CHECK (ephemeral IN (0, 1)),
      name              TEXT,
      metadata          TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
      CHECK ((parent_session_id IS NOT NULL) = (worker_type IN ('session', 'file'))),
      CHECK ((file_path IS NOT NULL) = (worker_type = 'file')),
      CHECK ((app_id IS NOT NULL) = (worker_type = 'app')),
      CHECK ((channel_id IS NOT NULL) = (worker_type = 'channel')),
      CHECK (worker_type <> 'inbox' OR ephemeral = 0)
    );

    CREATE INDEX IF NOT EXISTS idx_workers_parent_session_id
      ON workers(parent_session_id);

    CREATE INDEX IF NOT EXISTS idx_workers_app_id
      ON workers(app_id);

    CREATE INDEX IF NOT EXISTS idx_workers_channel_id
      ON workers(channel_id, session_id);

    CREATE INDEX IF NOT EXISTS idx_workers_type_created
      ON workers(worker_type, created_at DESC, session_id);
  `);
}
