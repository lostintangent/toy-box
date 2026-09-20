// Shared application database.
//
// Opens a single SQLite connection at ~/.toy-box/toy-box.sqlite and creates
// the current feature tables on startup. Each feature owns its schema and row
// lifecycle; this module owns the connection, pragmas, and schema ordering.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { initializeAppSchema } from "@apps/server/schema";
import { initializeAutomationSchema } from "@automations/server/schema";
import { initializeChannelSchema } from "@channels/server/schema";
import { initializeInboxSchema } from "@inbox/server/schema";
import { initializeSessionSchema } from "@sessions/server/schema";
import { initializeWorkerSchema } from "@workers/server/schema";
import { initializeWorkspaceSchema } from "@workspace/server/state/schema";
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

  // Feature schemas are composed here so one connection still owns ordering
  // and transaction behavior without owning each feature's persistence model.
  await initializeSessionSchema(db);
  await initializeWorkerSchema(db);
  await initializeChannelSchema(db);
  await initializeAutomationSchema(db);
  await initializeInboxSchema(db);
  await initializeAppSchema(db);
  await initializeWorkspaceSchema(db);
}

/** Create a standalone database connection for tests that need isolated state. */
export async function createTestDatabase(path = ":memory:"): Promise<Bun.SQL> {
  const db = createRuntimeDatabase(path);
  await initializeSchema(db, path);
  return db;
}
