import type { DraftSession } from "@/types";
import { getStateDatabase } from "../database";

export async function getDraftSessions(): Promise<DraftSession[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<DraftSessionRow[]>`SELECT * FROM drafts ORDER BY created_at DESC`;
  return rows.map(draftSessionFromRow);
}

export async function getDraftSession(sessionId: string): Promise<DraftSession | null> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return null;
  const [row] = await db<DraftSessionRow[]>`
    SELECT * FROM drafts WHERE session_id = ${sessionId}
  `;
  return row ? draftSessionFromRow(row) : null;
}

export async function persistDraftSession(draft: DraftSession): Promise<void> {
  const db = await getStateDatabase();
  await db`
    INSERT INTO drafts (session_id, artifact_path, created_at)
    VALUES (${draft.sessionId}, ${draft.artifactPath ?? null}, ${draft.createdAt})
  `;
}

export async function deleteDraftSession(sessionId: string): Promise<void> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  await db`DELETE FROM drafts WHERE session_id = ${sessionId}`;
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
