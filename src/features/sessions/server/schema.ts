/** Install the current tables whose meaning is owned by Sessions. */
export async function initializeSessionSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      provider_id TEXT,
      native_id TEXT,
      created_at INTEGER NOT NULL,
      artifact_path TEXT,
      CHECK ((provider_id IS NULL) = (native_id IS NULL)),
      UNIQUE(provider_id, native_id)
    );

    CREATE TABLE IF NOT EXISTS worktrees (
      session_id           TEXT PRIMARY KEY,
      worktree_path        TEXT NOT NULL,
      worktree_branch      TEXT NOT NULL,
      worktree_base_branch TEXT NOT NULL,
      lines_added          INTEGER,
      lines_removed        INTEGER
    );
  `);
}
