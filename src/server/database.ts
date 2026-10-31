// Shared application database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and migrates it
// on startup. Each feature's `server/schema.ts` default-exports its schema: an
// ordered list of versions that builds its tables. The `feature_schemas` table
// records which version of each feature's schema is installed, by folder name.
// This module owns the connection, its pragmas, and discovering those schemas.
//
// To change a feature's tables, append a version to its schema. Never edit or
// reorder one that has shipped. Versions run with foreign keys enforced, so
// rebuilding a referenced table in one would cascade into its rows.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { byFeature } from "@/shared/features";
import { sharedMap } from "@/shared/server/processState";

const featureSchemas = byFeature(
  import.meta.glob<readonly string[]>("../features/*/server/schema.ts", {
    eager: true,
    import: "default",
  }),
);

const databases = sharedMap<Promise<Bun.SQL>>("state-databases");

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

/** Run an operation atomically. Bun queues overlapping transactions on the
 * shared connection, but any query issued while one is open joins it. Await
 * only database calls inside, so unrelated work never lands in a transaction. */
export function inStateTransaction<Result>(
  db: Bun.SQL,
  operation: (transaction: Bun.SQL) => Promise<Result>,
): Promise<Result> {
  return db.begin("IMMEDIATE", operation);
}

/** Install each feature schema's versions that this database hasn't run yet,
 * one feature per transaction, and record the version it reached. The record
 * never moves backwards, so an older Toy Box can't make a newer one rerun its
 * versions. */
export async function migrate(
  db: Bun.SQL,
  featureSchemas: Record<string, readonly string[]>,
): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS feature_schemas (
      name    TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    )
  `;

  for (const [name, versions] of Object.entries(featureSchemas)) {
    await inStateTransaction(db, async (transaction) => {
      const [recorded] = await transaction<{ version: number }[]>`
        SELECT version FROM feature_schemas WHERE name = ${name}
      `;
      for (const version of versions.slice(recorded?.version ?? 0)) {
        await transaction.unsafe(version);
      }
      await transaction`
        INSERT INTO feature_schemas (name, version) VALUES (${name}, ${versions.length})
        ON CONFLICT (name) DO UPDATE SET version = excluded.version
        WHERE excluded.version > version
      `;
    });
  }
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

  await migrate(db, featureSchemas);
}

/** Create a standalone database connection for tests that need isolated state. */
export async function createTestDatabase(path = ":memory:"): Promise<Bun.SQL> {
  const db = createRuntimeDatabase(path);
  await initializeSchema(db, path);
  return db;
}
