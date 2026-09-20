// Sessions owns durable IDs and provider associations; providers own native metadata and history.
import type { Session } from "@sessions/model";
import { getStateDatabase } from "@/server/database";

export async function readSessions(): Promise<Session[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  return (await db<SessionRow[]>`SELECT * FROM sessions`).map(sessionFromRow);
}

export async function readSession(id: string): Promise<Session | undefined> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return undefined;
  const [row] = await db<SessionRow[]>`SELECT * FROM sessions WHERE session_id = ${id}`;
  return row ? sessionFromRow(row) : undefined;
}

export async function insertSession(
  session: Pick<Session, "id" | "createdAt" | "artifactPath">,
): Promise<void> {
  const db = await getStateDatabase();
  await db`
    INSERT INTO sessions (session_id, artifact_path, created_at)
    VALUES (${session.id}, ${session.artifactPath ?? null}, ${session.createdAt.getTime()})
  `;
}

export async function setSessionProvider(
  id: string,
  provider: NonNullable<Session["provider"]>,
): Promise<void> {
  const db = await getStateDatabase();
  const nativeId = provider.sessionId && provider.sessionId !== id ? provider.sessionId : null;
  await db`INSERT INTO sessions (session_id, provider_id, native_id, created_at)
    VALUES (${id}, ${provider.id}, ${nativeId}, ${Date.now()})
    ON CONFLICT(session_id) DO UPDATE SET
      provider_id = excluded.provider_id, native_id = excluded.native_id
    WHERE sessions.provider_id IS NULL`;
  const persisted = await readSession(id);
  if (
    persisted?.provider?.id !== provider.id ||
    (persisted.provider.sessionId ?? id) !== (nativeId ?? id)
  ) {
    throw new Error("Session already uses a different provider history.");
  }
}

export async function deleteSessionRecord(id: string): Promise<void> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  await db`DELETE FROM sessions WHERE session_id = ${id}`;
}

type SessionRow = {
  session_id: string;
  provider_id: string | null;
  native_id: string | null;
  artifact_path: string | null;
  created_at: number;
};

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.session_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.created_at),
    ...(row.provider_id
      ? {
          provider: { id: row.provider_id, ...(row.native_id ? { sessionId: row.native_id } : {}) },
        }
      : {}),
    ...(row.artifact_path ? { artifactPath: row.artifact_path } : {}),
  };
}
