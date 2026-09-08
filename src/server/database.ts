// Shared application database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and creates
// the current feature tables on startup. Each feature owns the meaning and
// lifecycle, and schema of its rows; this module owns the connection and schema ordering.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { initializeAgentSchema } from "@agents/server/schema";
import { initializeChannelSchema } from "@channels/server/schema";
import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";
import { sharedMap, sharedWeakMap } from "@/shared/server/processState";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";

const databases = sharedMap<Promise<Bun.SQL>>("state-databases");
const transactionQueues = sharedWeakMap<Bun.SQL, SerialTaskQueue>("state-transaction-queues");

export function getStateDatabase(): Promise<Bun.SQL>;
export function getStateDatabase(options: { createIfMissing: false }): Promise<Bun.SQL | null>;
export function getStateDatabase(
  options: { createIfMissing?: false } = {},
): Promise<Bun.SQL | null> {
  let database = databases.get("default");
  if (!database) {
    const path = resolveDefaultPath();
    if (options.createIfMissing === false && !existsSync(path)) {
      return Promise.resolve(null);
    }

    database = (async () => {
      const db = createRuntimeDatabase(path);
      await initializeSchema(db, path);
      return db;
    })();
    databases.set("default", database);
  }
  return database;
}

/** Bun's SQLite adapter uses one connection and does not queue overlapping
 * `begin` calls. Serialize application transactions per connection so
 * independent background completions cannot accidentally nest them. */
export async function inStateTransaction<Result>(
  db: Bun.SQL,
  operation: (transaction: Bun.SQL) => Promise<Result>,
): Promise<Result> {
  let queue = transactionQueues.get(db);
  if (!queue) {
    queue = new SerialTaskQueue();
    transactionQueues.set(db, queue);
  }
  return queue.enqueue(() => db.begin("IMMEDIATE", operation));
}

function resolveDefaultPath(): string {
  const home = homedir().trim();
  if (home.length > 0) return join(home, ".toy-box", "toy-box.sqlite");
  return join(process.cwd(), ".toy-box", "toy-box.sqlite");
}

function createRuntimeDatabase(path: string): Bun.SQL {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new Bun.SQL({ adapter: "sqlite", filename: path, strict: true });
}

async function initializeSchema(db: Bun.SQL, path: string): Promise<void> {
  await db`PRAGMA foreign_keys = ON`;
  if (path !== ":memory:") {
    await db`PRAGMA journal_mode = WAL`;
    await db`PRAGMA synchronous = NORMAL`;
  }

  // This schema has not shipped, so startup defines its current shape directly.
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

    CREATE TABLE IF NOT EXISTS worktrees (
      session_id           TEXT PRIMARY KEY,
      worktree_path        TEXT NOT NULL,
      worktree_branch      TEXT NOT NULL,
      worktree_base_branch TEXT NOT NULL,
      lines_added          INTEGER,
      lines_removed        INTEGER
    );

    CREATE TABLE IF NOT EXISTS workers (
      session_id        TEXT PRIMARY KEY,
      worker_type       TEXT NOT NULL
        CHECK (worker_type IN ('session', 'file', 'app')),
      parent_session_id TEXT,
      app_id            TEXT,
      ephemeral         INTEGER NOT NULL
        CHECK (ephemeral IN (0, 1)),
      CHECK (
        (
          worker_type = 'app'
          AND parent_session_id IS NULL
          AND app_id IS NOT NULL
        )
        OR
        (
          worker_type IN ('session', 'file')
          AND parent_session_id IS NOT NULL
          AND app_id IS NULL
        )
      )
    );

    CREATE INDEX IF NOT EXISTS idx_workers_parent_session_id
      ON workers(parent_session_id);

    CREATE INDEX IF NOT EXISTS idx_workers_app_id
      ON workers(app_id);

    CREATE TABLE IF NOT EXISTS drafts (
      session_id    TEXT PRIMARY KEY,
      artifact_path TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inbox (
      id         TEXT PRIMARY KEY,
      message    TEXT,
      artifact   TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL CHECK (json_valid(value))
    );

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

  // Feature schemas are composed here so one connection still owns ordering
  // and transaction behavior without owning each feature's persistence model.
  await initializeAgentSchema(db);
  await initializeChannelSchema(db);
}

/** Create a standalone database connection for tests that need isolated state. */
export async function createTestDatabase(path = ":memory:"): Promise<Bun.SQL> {
  const db = createRuntimeDatabase(path);
  await initializeSchema(db, path);
  return db;
}
