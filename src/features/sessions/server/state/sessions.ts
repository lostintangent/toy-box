// Durable public identity. A session is a draft until it binds to native history.
import type { DraftSession } from "@sessions/model";
import type { SessionIdentity } from "@providers/server/provider";
import { getStateDatabase } from "@/server/database";

export async function getDraftSessions(): Promise<DraftSession[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<DraftSessionRow[]>`
    SELECT * FROM sessions WHERE provider_id IS NULL ORDER BY created_at DESC
  `;
  return rows.map(draftSessionFromRow);
}

export async function getDraftSession(sessionId: string): Promise<DraftSession | null> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return null;
  const [row] = await db<DraftSessionRow[]>`
    SELECT * FROM sessions WHERE session_id = ${sessionId} AND provider_id IS NULL
  `;
  return row ? draftSessionFromRow(row) : null;
}

export async function persistDraftSession(draft: DraftSession): Promise<void> {
  const db = await getStateDatabase();
  await db`
    INSERT INTO sessions (session_id, artifact_path, created_at)
    VALUES (${draft.sessionId}, ${draft.artifactPath ?? null}, ${draft.createdAt})
  `;
}

export async function readProviderBindings(): Promise<SessionIdentity[]> {
  const db = await getStateDatabase();
  const rows = await db<BindingRow[]>`SELECT * FROM sessions WHERE provider_id IS NOT NULL`;
  return rows.map(identity);
}

export async function readProviderBinding(sessionId: string): Promise<SessionIdentity | undefined> {
  const db = await getStateDatabase();
  const [row] = await db<BindingRow[]>`
    SELECT * FROM sessions WHERE session_id = ${sessionId} AND provider_id IS NOT NULL
  `;
  return row ? identity(row) : undefined;
}

export async function bindProviderSession(binding: SessionIdentity): Promise<void> {
  const db = await getStateDatabase();
  await db`INSERT INTO sessions (session_id, provider_id, native_id, created_at)
    VALUES (${binding.sessionId}, ${binding.providerId}, ${binding.nativeId}, ${Date.now()})
    ON CONFLICT(session_id) DO UPDATE SET
      provider_id = excluded.provider_id, native_id = excluded.native_id
    WHERE sessions.provider_id IS NULL`;
  const persisted = await readProviderBinding(binding.sessionId);
  if (persisted?.providerId !== binding.providerId || persisted.nativeId !== binding.nativeId) {
    throw new Error("Session is already bound to a different provider history.");
  }
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  await db`DELETE FROM sessions WHERE session_id = ${sessionId}`;
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

type BindingRow = {
  session_id: string;
  provider_id: string;
  native_id: string;
};

function identity(row: BindingRow): SessionIdentity {
  return {
    sessionId: row.session_id,
    providerId: row.provider_id,
    nativeId: row.native_id,
  };
}
