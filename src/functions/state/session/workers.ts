// Durable ownership and lifetime policy for worker sessions.
//
// The SDK owns session history. This table identifies sessions managed as workers,
// keeps them out of the ordinary session list, and tells supervisors which
// sessions to delete after execution or an interrupted process.

import { getStateDatabase } from "../database";
import { workerParentSessionId } from "@/lib/workers";
import type { Worker } from "@/types";

/** Map every worker session to its parent session, or null when its owner is an app. */
export async function getWorkerSessionParents(): Promise<Record<string, string | null>> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return {};
  const rows = await db<WorkerSessionParentRow[]>`
    SELECT session_id, parent_session_id
    FROM workers
    ORDER BY session_id
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
    SELECT session_id FROM workers
    WHERE app_id = ${appId}
    ORDER BY session_id
  `;
  return rows.map((row) => row.session_id);
}

/** Ephemeral workers cannot outlive their process-local supervisor. */
export async function getEphemeralWorkerSessionIds(): Promise<string[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<WorkerSessionIdRow[]>`
    SELECT session_id FROM workers
    WHERE ephemeral = 1
    ORDER BY session_id
  `;
  return rows.map((row) => row.session_id);
}

/** Recover the capability scope of an app worker resumed in a new process. */
export async function getWorkerAppId(sessionId: string): Promise<string | undefined> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  const [row] = await db<{ app_id: string | null }[]>`
    SELECT app_id
    FROM workers
    WHERE session_id = ${sessionId}
  `;
  return row?.app_id ?? undefined;
}

export async function registerWorkerSession(worker: Worker): Promise<void> {
  const db = await getStateDatabase();
  const parentSessionId = workerParentSessionId(worker);
  const appId = worker.type === "app" ? worker.appId : undefined;
  await db`
    INSERT OR IGNORE INTO workers (
      session_id,
      worker_type,
      parent_session_id,
      app_id,
      ephemeral
    )
    VALUES (
      ${worker.sessionId},
      ${worker.type},
      ${parentSessionId ?? null},
      ${appId ?? null},
      ${worker.ephemeral ? 1 : 0}
    )
  `;
}

export async function unregisterWorkerSession(sessionId: string): Promise<void> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  await db`DELETE FROM workers WHERE session_id = ${sessionId}`;
}

type WorkerSessionIdRow = {
  session_id: string;
};

type WorkerSessionParentRow = WorkerSessionIdRow & {
  parent_session_id: string | null;
};
