// Shared application database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and creates
// all tables on startup. Modules that need persistence (automations,
// worktrees) import getAppDatabase() and share the same connection.

import { mkdirSync } from "node:fs";
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

  // Automations table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
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
      worktree_path        TEXT,
      worktree_branch      TEXT,
      worktree_base_branch TEXT,
      lines_added          INTEGER,
      lines_removed        INTEGER
    );
  `);
}

let dbPromise: Promise<Database> | undefined;

export function getAppDatabase(): Promise<Database> {
  if (!dbPromise) {
    const path = resolveDefaultPath();
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
