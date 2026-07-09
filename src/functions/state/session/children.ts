// Persistent parent/child session links.
//
// The SDK owns session history. This table is a small index that lets the
// session list hide sessions created by another session without replaying each
// session's history.

import { getAppDatabase } from "../database";

export async function getChildSessionIds(): Promise<string[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`SELECT session_id FROM child_sessions ORDER BY session_id`;
  return (rows as ChildSessionIdRow[]).map((row) => row.session_id);
}

export async function getChildSessionIdsForParent(parentSessionId: string): Promise<string[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`
    SELECT session_id FROM child_sessions
    WHERE parent_session_id = ${parentSessionId}
    ORDER BY session_id
  `;
  return (rows as ChildSessionIdRow[]).map((row) => row.session_id);
}

export async function linkChildSession(sessionId: string, parentSessionId: string): Promise<void> {
  const db = await getAppDatabase();
  await db.sql`
    INSERT OR IGNORE INTO child_sessions (session_id, parent_session_id)
    VALUES (${sessionId}, ${parentSessionId})
  `;
}

export async function unlinkChildSession(sessionId: string): Promise<void> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return;
  await db.sql`DELETE FROM child_sessions WHERE session_id = ${sessionId}`;
}

type ChildSessionIdRow = {
  session_id: string;
};
