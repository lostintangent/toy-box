// Shared application database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and creates
// all tables on startup. Modules that need persistence (automations,
// worktrees) import getAppDatabase() and share the same connection.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabase, type Database } from "db0";
import type { Connector } from "db0";

function resolveDefaultPath(): string {
  const home = homedir().trim();
  if (home.length > 0) {
    return join(home, ".toy-box", "toy-box.sqlite");
  }

  return join(process.cwd(), ".toy-box", "toy-box.sqlite");
}

async function createRuntimeSqliteConnector(): Promise<
  (options: { cwd?: string; path?: string; name?: string }) => Connector
> {
  if (typeof Bun !== "undefined") {
    const module = await import("db0/connectors/bun-sqlite");
    return module.default as (options: { cwd?: string; path?: string; name?: string }) => Connector;
  }

  const module = await import("db0/connectors/node-sqlite");
  return module.default as (options: { cwd?: string; path?: string; name?: string }) => Connector;
}

async function createRuntimeDatabase(path: string): Promise<Database> {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const connectorFactory = await createRuntimeSqliteConnector();
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
  // Automations table
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
      last_run_at TEXT,
      last_run_session_id TEXT,
      reuse_session INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_automations_next_run_at
      ON automations(next_run_at);
  `);

  // Worktrees table
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
    CREATE TABLE IF NOT EXISTS child_sessions (
      session_id        TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_child_sessions_parent_session_id
      ON child_sessions(parent_session_id);
  `);
}

let dbPromise: Promise<Database> | undefined;

type AppDatabaseOptions = {
  createIfMissing?: boolean;
};

type AppDatabaseResult<T extends AppDatabaseOptions | undefined> = T extends {
  createIfMissing: false;
}
  ? Database | null
  : Database;

export function getAppDatabase<T extends AppDatabaseOptions | undefined = undefined>(
  options?: T,
): Promise<AppDatabaseResult<T>>;
export function getAppDatabase(options: AppDatabaseOptions = {}): Promise<Database | null> {
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

export async function closeAppDatabase(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = undefined;
  try {
    await db.exec("PRAGMA optimize;");
  } catch {
    // Ignore errors (e.g., in-memory databases already disposed).
  }
  await db.dispose();
}

/** Create a standalone database connection — used by tests that need isolated instances. */
export async function createTestDatabase(path = ":memory:"): Promise<Database> {
  const db = await createRuntimeDatabase(path);
  await initializeSchema(db, path);
  return db;
}
