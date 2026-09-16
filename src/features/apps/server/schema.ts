import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";

/** Install the current tables whose meaning is owned by Apps. */
export async function initializeAppSchema(db: Bun.SQL): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS apps (
      id            TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      title         TEXT NOT NULL,
      color         TEXT NOT NULL,
      state         TEXT NOT NULL CHECK (
        json_valid(state)
        AND length(CAST(state AS BLOB)) <= ${SMALL_JSON_MAX_BYTES}
      ),
      revision      INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(revision) = 'integer' AND revision >= 0),
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_apps_updated_at
      ON apps(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_apps_definition_id
      ON apps(definition_id);

    CREATE TABLE IF NOT EXISTS app_shares (
      id            TEXT PRIMARY KEY,
      source_app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
      target_app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      mime_type     TEXT NOT NULL,
      content       TEXT NOT NULL CHECK (
        json_valid(content)
        AND length(CAST(content AS BLOB)) <= ${SMALL_JSON_MAX_BYTES}
      ),
      created_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_shares_target_app_id
      ON app_shares(target_app_id, created_at);
  `);
}
