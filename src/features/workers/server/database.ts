// Persisted ownership and lifetime policy for worker sessions.

import { sessionFile } from "@files/model";
import { getStateDatabase } from "@/server/database";
import { smallJsonSchema } from "@/shared/smallJson";
import type { Worker } from "../model";

/** Worker persistence that owners can compose into their own transactions. */
export class WorkerDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async get(sessionId: string): Promise<Worker | null> {
    const [row] = await this.db<WorkerRow[]>`
      SELECT * FROM workers WHERE session_id = ${sessionId}
    `;
    return row ? workerFromRow(row) : null;
  }

  async list<Type extends Worker["type"]>(type: Type): Promise<Extract<Worker, { type: Type }>[]> {
    const rows = await this.db<WorkerRow[]>`
      SELECT * FROM workers WHERE worker_type = ${type} ORDER BY session_id
    `;
    return rows.map((row) => workerFromRow(row) as Extract<Worker, { type: Type }>);
  }

  async listForChannel(channelId: string): Promise<Extract<Worker, { type: "channel" }>[]> {
    const rows = await this.db<WorkerRow[]>`
      SELECT * FROM workers
      WHERE worker_type = 'channel' AND channel_id = ${channelId}
      ORDER BY name COLLATE NOCASE, session_id
    `;
    return rows.map((row) => workerFromRow(row) as Extract<Worker, { type: "channel" }>);
  }

  async create(worker: Worker): Promise<void> {
    const columns = workerColumns(worker);
    await this.db`
      INSERT INTO workers (
        session_id, worker_type, parent_session_id, file_path, app_id, channel_id,
        ephemeral, name, metadata
      ) VALUES (
        ${worker.sessionId}, ${worker.type}, ${columns.parentSessionId ?? null},
        ${columns.filePath ?? null}, ${columns.appId ?? null}, ${columns.channelId ?? null},
        ${worker.ephemeral ? 1 : 0}, ${worker.name ?? null},
        ${worker.metadata === undefined ? null : JSON.stringify(worker.metadata)}
      )
    `;
  }

  async update(
    sessionId: string,
    details: { name: Worker["name"]; metadata: Worker["metadata"] },
  ): Promise<boolean> {
    const rows = await this.db<{ session_id: string }[]>`
      UPDATE workers
      SET name = ${details.name ?? null},
          metadata = ${details.metadata === undefined ? null : JSON.stringify(details.metadata)}
      WHERE session_id = ${sessionId}
      RETURNING session_id
    `;
    return rows.length > 0;
  }

  async delete(sessionId: string): Promise<boolean> {
    const rows = await this.db<{ session_id: string }[]>`
      DELETE FROM workers WHERE session_id = ${sessionId} RETURNING session_id
    `;
    return rows.length > 0;
  }
}

/** Map every worker session to its parent session, or null for non-Session owners. */
export async function getWorkerSessionParents(): Promise<Record<string, string | null>> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return {};
  const rows = await db<WorkerSessionParentRow[]>`
    SELECT session_id, parent_session_id FROM workers ORDER BY session_id
  `;
  return Object.fromEntries(rows.map((row) => [row.session_id, row.parent_session_id]));
}

export async function getWorkerSessionIdsForParent(parentSessionId: string): Promise<string[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<WorkerSessionIdRow[]>`
    SELECT session_id FROM workers
    WHERE parent_session_id = ${parentSessionId}
    ORDER BY session_id
  `;
  return rows.map((row) => row.session_id);
}

export async function getWorkerSessionIdsForApp(appId: string): Promise<string[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<WorkerSessionIdRow[]>`
    SELECT session_id FROM workers WHERE app_id = ${appId} ORDER BY session_id
  `;
  return rows.map((row) => row.session_id);
}

/** Ephemeral workers cannot outlive their process-local supervisor. */
export async function getEphemeralWorkerSessionIds(): Promise<string[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<WorkerSessionIdRow[]>`
    SELECT session_id FROM workers WHERE ephemeral = 1 ORDER BY session_id
  `;
  return rows.map((row) => row.session_id);
}

export async function getPersistedWorker(sessionId: string): Promise<Worker | null> {
  const db = await getStateDatabase({ createIfMissing: false });
  return db ? new WorkerDatabase(db).get(sessionId) : null;
}

export async function registerWorkerSession(worker: Worker): Promise<void> {
  await new WorkerDatabase(await getStateDatabase()).create(worker);
}

export async function unregisterWorkerSession(sessionId: string): Promise<void> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (db) await new WorkerDatabase(db).delete(sessionId);
}

function workerColumns(worker: Worker) {
  switch (worker.type) {
    case "session":
      return { parentSessionId: worker.parentSessionId };
    case "file":
      return { parentSessionId: worker.file.sessionId, filePath: worker.file.path };
    case "app":
      return { appId: worker.appId };
    case "channel":
      return { channelId: worker.channelId };
  }
}

function workerFromRow(row: WorkerRow): Worker {
  const common = {
    sessionId: row.session_id,
    ephemeral: row.ephemeral === 1,
    ...(row.name ? { name: row.name } : {}),
    ...(row.metadata ? { metadata: smallJsonSchema.parse(JSON.parse(row.metadata)) } : {}),
  };
  switch (row.worker_type) {
    case "session":
      return { ...common, type: "session", parentSessionId: row.parent_session_id! };
    case "file":
      return {
        ...common,
        type: "file",
        file: sessionFile(row.parent_session_id!, row.file_path!),
      };
    case "app":
      return { ...common, type: "app", appId: row.app_id! };
    case "channel":
      return { ...common, type: "channel", channelId: row.channel_id! };
  }
}

type WorkerRow = {
  session_id: string;
  worker_type: Worker["type"];
  parent_session_id: string | null;
  file_path: string | null;
  app_id: string | null;
  channel_id: string | null;
  ephemeral: number;
  name: string | null;
  metadata: string | null;
};

type WorkerSessionIdRow = { session_id: string };
type WorkerSessionParentRow = WorkerSessionIdRow & { parent_session_id: string | null };
