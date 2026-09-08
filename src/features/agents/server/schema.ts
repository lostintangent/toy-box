/** Install the current tables whose meaning is owned by Agents. */
export async function initializeAgentSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS agents (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      persona             TEXT,
      model_configuration TEXT
        CHECK (model_configuration IS NULL OR json_valid(model_configuration)),
      avatar_mark         TEXT,
      avatar_color        TEXT,
      CHECK ((avatar_mark IS NULL) = (avatar_color IS NULL))
    );

    CREATE INDEX IF NOT EXISTS idx_agents_name
      ON agents(name COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS agent_experiences (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content    TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, content)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_experiences_agent
      ON agent_experiences(agent_id, created_at DESC, id);

    CREATE TABLE IF NOT EXISTS agent_memberships (
      session_id     TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL REFERENCES agents(id),
      host_kind      TEXT NOT NULL CHECK (host_kind IN ('session', 'channel', 'file')),
      host_id        TEXT NOT NULL CHECK (host_kind <> 'file' OR json_valid(host_id)),
      execution_mode TEXT NOT NULL CHECK (execution_mode IN ('shared', 'worktree')),
      UNIQUE(host_kind, host_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memberships_host
      ON agent_memberships(host_kind, host_id, session_id);

    CREATE INDEX IF NOT EXISTS idx_agent_memberships_agent
      ON agent_memberships(agent_id, session_id);
  `);
}
