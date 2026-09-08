/** Install the current tables whose meaning is owned by Channels. */
export async function initializeChannelSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS channels (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      directory       TEXT,
      latest_sequence INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(latest_sequence) = 'integer' AND latest_sequence >= 0),
      event_cursor    INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(event_cursor) = 'integer' AND event_cursor >= 0),
      seen_through    INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(seen_through) = 'integer' AND seen_through >= 0),
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_channels_updated_at
      ON channels(updated_at DESC, id);

    CREATE TABLE IF NOT EXISTS channel_members (
      session_id   TEXT PRIMARY KEY REFERENCES agent_memberships(session_id) ON DELETE CASCADE,
      seen_through INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(seen_through) = 'integer' AND seen_through >= 0)
    );

    CREATE TABLE IF NOT EXISTS channel_messages (
      id                   TEXT PRIMARY KEY,
      channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      sequence             INTEGER NOT NULL
        CHECK (typeof(sequence) = 'integer' AND sequence > 0),
      sender_type          TEXT NOT NULL CHECK (sender_type IN ('user', 'agent', 'system')),
      sender_agent_id      TEXT,
      content              TEXT NOT NULL,
      attachments          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments)),
      timestamp            TEXT NOT NULL,
      UNIQUE(channel_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS channel_message_reactions (
      channel_id       TEXT NOT NULL,
      message_sequence INTEGER NOT NULL,
      agent_id         TEXT NOT NULL,
      reaction         TEXT NOT NULL
        CHECK (reaction IN ('looking', 'agree', 'celebrate', 'love', 'laugh')),
      PRIMARY KEY(channel_id, message_sequence, agent_id),
      FOREIGN KEY(channel_id, message_sequence)
        REFERENCES channel_messages(channel_id, sequence) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_artifacts (
      channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      kind                 TEXT NOT NULL CHECK (kind IN ('session', 'machine')),
      session_id           TEXT,
      path                 TEXT NOT NULL,
      title                TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      CHECK (
        (kind = 'session' AND session_id IS NOT NULL) OR
        (kind = 'machine' AND session_id IS NULL)
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_artifacts_machine
      ON channel_artifacts(channel_id, path) WHERE kind = 'machine';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_artifacts_session
      ON channel_artifacts(channel_id, session_id, path) WHERE kind = 'session';

    CREATE INDEX IF NOT EXISTS idx_channel_artifacts_channel
      ON channel_artifacts(channel_id, created_at, kind, session_id, path);
  `);
}
