// Application composition for Session resources governed by another feature.
// Sessions supplies execution and teardown; managing features supply ownership
// and presentation policy without entering the Session kernel.

import type { SessionOwnership, SessionsState, SessionType } from "@sessions/model";
import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import { getHyperSessionIds, hasHyperSession } from "@workspace/server/state/hyperSessions";
import { getSessionStates } from "@workspace/server/state/sessions";
import { getSettings } from "@workspace/server/state/settings";

const RECENT_SESSION_LIMIT = 250;

/** Read the public Session catalog with feature-owned visibility and relationships. */
export async function readSessionCatalog(
  readCatalog: () => Promise<[SessionsState["sessions"], SessionsState["worktrees"]]>,
): Promise<SessionsState> {
  // Ownership precedes SDK creation and outlives SDK deletion. Read it on both
  // sides so a concurrent change cannot expose a backing Session as ordinary.
  const ownershipBefore = await readSessionOwnership();
  const [sessions, worktrees] = await readCatalog();
  const [ownershipAfter, settings] = await Promise.all([readSessionOwnership(), getSettings()]);
  const ownership = { ...ownershipBefore, ...ownershipAfter };
  const retainedSessionIds = new Set([
    ...Object.keys(ownership),
    ...getHyperSessionIds(),
    ...settings.pinnedSessionIds,
  ]);
  // Managed sessions and pins do not consume the ordinary-history budget.
  const recentSessions = sessions
    .filter(({ id }) => !retainedSessionIds.has(id))
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
    )
    .slice(0, RECENT_SESSION_LIMIT);
  for (const { id } of recentSessions) retainedSessionIds.add(id);
  for (const id of Object.keys(getSessionStates())) retainedSessionIds.add(id);
  return {
    sessions: sessions.filter(({ id, provider }) => retainedSessionIds.has(id) || !provider),
    worktrees,
    ownership,
  };
}

/** Resolve the role claimed for a Session by application features. */
export async function resolveSessionType(sessionId: string): Promise<SessionType> {
  const database = await getStateDatabase({ createIfMissing: false });
  const [claims] = database
    ? await database<{ automation: number; worker: number }[]>`
        SELECT
          EXISTS(SELECT 1 FROM automations WHERE id = ${sessionId}) AS automation,
          EXISTS(SELECT 1 FROM workers WHERE session_id = ${sessionId}) AS worker
      `
    : [];
  const types: SessionType[] = [];
  if (claims?.automation) types.push("automation");
  if (claims?.worker) types.push("worker");
  if (hasHyperSession(sessionId)) types.push("hyper");
  if (types.length > 1) {
    throw new Error(`Session ${sessionId} has conflicting types: ${types.join(", ")}`);
  }
  return types[0] ?? "standard";
}

/** Delete the managed Session resources owned by one Session before its own teardown. */
export async function deleteOwnedSessions(sessionId: string): Promise<void> {
  const { deleteWorkersForSession } = await import("@workers/server");
  await deleteWorkersForSession(sessionId);
}

/** Remove feature ownership after the shared Session resource is gone. */
export async function detachManagedSession(sessionId: string): Promise<void> {
  const { getPersistedWorker, unregisterWorkerSession } = await import("@workers/server/database");
  const worker = await getPersistedWorker(sessionId);
  if (worker?.type === "channel") {
    const { detachChannelAgentSession } = await import("@channels/server");
    await detachChannelAgentSession(sessionId);
  } else if (worker && (await unregisterWorkerSession(sessionId))) {
    if (worker.type === "inbox") {
      broadcast({ type: "inbox.entry.deleted", entryId: sessionId });
    }
  }
}

async function readSessionOwnership(): Promise<SessionsState["ownership"]> {
  const database = await getStateDatabase({ createIfMissing: false });
  if (!database) return {};
  const rows = await database<
    { session_id: string; type: SessionOwnership["type"]; parent_session_id: string | null }[]
  >`
    SELECT id AS session_id, 'automation' AS type, NULL AS parent_session_id
      FROM automations
    UNION ALL
    SELECT session_id, 'worker', parent_session_id
      FROM workers
  `;
  const ownership: SessionsState["ownership"] = {};
  for (const row of rows) {
    const previous = ownership[row.session_id];
    if (previous) {
      throw new Error(
        `Session ${row.session_id} has conflicting types: ${previous.type}, ${row.type}`,
      );
    }
    ownership[row.session_id] =
      row.type === "worker"
        ? { type: "worker", parentSessionId: row.parent_session_id }
        : { type: row.type };
  }
  return ownership;
}
