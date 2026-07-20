// Durable ownership and retention policy for sessions created by another session.
//
// The SDK owns session history. This table identifies sessions managed as workers,
// keeps them out of the ordinary session list, and tells startup cleanup which
// workers are safe to discard after their supervising process exits.

import { getAppDatabase } from "../database";

export async function getWorkerSessionIds(): Promise<string[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`SELECT session_id FROM workers ORDER BY session_id`;
  return (rows as WorkerSessionIdRow[]).map((row) => row.session_id);
}

export async function getWorkerSessionIdsForParent(parentSessionId: string): Promise<string[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`
    SELECT session_id FROM workers
    WHERE parent_session_id = ${parentSessionId}
    ORDER BY session_id
  `;
  return (rows as WorkerSessionIdRow[]).map((row) => row.session_id);
}

/** Disposable workers cannot be resumed safely without their process-local supervisor. */
export async function getDisposableWorkerSessionIds(): Promise<string[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`
    SELECT session_id FROM workers
    WHERE retained = ${0}
    ORDER BY session_id
  `;
  return (rows as WorkerSessionIdRow[]).map((row) => row.session_id);
}

export async function registerWorkerSession(
  sessionId: string,
  parentSessionId: string,
  retained = false,
): Promise<void> {
  const db = await getAppDatabase();
  await db.sql`
    INSERT OR IGNORE INTO workers (session_id, parent_session_id, retained)
    VALUES (${sessionId}, ${parentSessionId}, ${retained ? 1 : 0})
  `;
}

export async function unregisterWorkerSession(sessionId: string): Promise<void> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return;
  await db.sql`DELETE FROM workers WHERE session_id = ${sessionId}`;
}

type WorkerSessionIdRow = {
  session_id: string;
};
