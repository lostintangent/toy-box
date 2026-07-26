import type { DraftSession } from "@/types";
import { getAppDatabase } from "../database";

export async function getDraftSessions(): Promise<DraftSession[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`SELECT * FROM drafts ORDER BY created_at DESC`;
  return (rows as DraftSessionRow[]).map(draftSessionFromRow);
}

export async function getDraftSession(sessionId: string): Promise<DraftSession | null> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return null;
  const { rows } = await db.sql`
    SELECT * FROM drafts WHERE session_id = ${sessionId}
  `;
  const row = (rows as DraftSessionRow[])[0];
  return row ? draftSessionFromRow(row) : null;
}

export async function persistDraftSession(draft: DraftSession): Promise<void> {
  const db = await getAppDatabase();
  await db.sql`
    INSERT INTO drafts (session_id, artifact_path, created_at)
    VALUES (${draft.sessionId}, ${draft.artifactPath ?? null}, ${draft.createdAt})
  `;
}

export async function deleteDraftSession(sessionId: string): Promise<void> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return;
  await db.sql`DELETE FROM drafts WHERE session_id = ${sessionId}`;
}

type DraftSessionRow = {
  session_id: string;
  artifact_path: string | null;
  created_at: number;
};

function draftSessionFromRow(row: DraftSessionRow): DraftSession {
  return {
    sessionId: row.session_id,
    createdAt: row.created_at,
    ...(row.artifact_path ? { artifactPath: row.artifact_path } : {}),
  };
}
