// Shared server-state database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and creates
// all tables on startup. Automations and persisted session state share the
// same connection.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabase, type Database } from "db0";

let dbPromise: Promise<Database> | undefined;

export function getAppDatabase(): Promise<Database>;
export function getAppDatabase(options: { createIfMissing: false }): Promise<Database | null>;
export function getAppDatabase(
  options: { createIfMissing?: false } = {},
): Promise<Database | null> {
  if (!dbPromise) {
    const path = resolveDefaultPath();
    if (options.createIfMissing === false && !existsSync(path)) {
      return Promise.resolve(null);
    }

    dbPromise = (async () => {
      const db = await createRuntimeDatabase(path);
      await initializeSchema(db, path);
      return db;
    })();
  }
  return dbPromise;
}

function resolveDefaultPath(): string {
  const home = homedir().trim();
  if (home.length > 0) return join(home, ".toy-box", "toy-box.sqlite");
  return join(process.cwd(), ".toy-box", "toy-box.sqlite");
}

async function createRuntimeDatabase(path: string): Promise<Database> {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const connectorFactory =
    typeof Bun !== "undefined"
      ? (await import("db0/connectors/bun-sqlite")).default
      : (await import("db0/connectors/node-sqlite")).default;
  const connectorOptions = path === ":memory:" ? { name: ":memory:" } : { path };
  return createDatabase(connectorFactory(connectorOptions));
}

async function initializeSchema(db: Database, path: string): Promise<void> {
  await db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = NORMAL;");
  }

  // The app DB schema has not shipped yet, so startup defines the current shape
  // directly instead of carrying migrations for earlier local prototypes.
  await db.exec(`
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
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_automations_next_run_at
      ON automations(next_run_at);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      session_id           TEXT PRIMARY KEY,
      worktree_path        TEXT NOT NULL,
      worktree_branch      TEXT NOT NULL,
      worktree_base_branch TEXT NOT NULL,
      lines_added          INTEGER,
      lines_removed        INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      session_id        TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      retained          INTEGER NOT NULL DEFAULT 0
        CHECK (retained IN (0, 1))
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_workers_parent_session_id
      ON workers(parent_session_id);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox (
      id         TEXT PRIMARY KEY,
      message    TEXT,
      artifact   TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

/** Create a standalone database connection for tests that need isolated state. */
export async function createTestDatabase(path = ":memory:"): Promise<Database> {
  const db = await createRuntimeDatabase(path);
  await initializeSchema(db, path);
  return db;
}
