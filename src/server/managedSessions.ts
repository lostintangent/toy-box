// Application composition for Session resources governed by another feature.
// Sessions supplies execution and teardown; managing features supply ownership
// and presentation policy without entering the Session kernel.

import type { SessionsState, SessionType } from "@sessions/model";
import { getStateDatabase } from "@/server/database";
import { getHyperSessionIds, hasHyperSession } from "@workspace/server/state/hyperSessions";
import { getSessionStates } from "@workspace/server/state/sessions";
import { getSettings } from "@workspace/server/state/settings";

const RECENT_SESSION_LIMIT = 250;

/** Read the public Session catalog with feature-owned visibility and relationships. */
export async function readSessionCatalog(
  readCatalog: () => Promise<[SessionsState["sessions"], SessionsState["worktrees"]]>,
): Promise<SessionsState> {
  const { getWorkerSessionParents } = await import("@workers/server/database");
  const readOwnership = () => getWorkerSessionParents();
  // Ownership precedes SDK creation and outlives SDK deletion. Read it on both
  // sides so a concurrent change cannot expose a backing Session as ordinary.
  const workersBefore = await readOwnership();
  const [sessions, worktrees] = await readCatalog();
  const [workersAfter, settings, database] = await Promise.all([
    readOwnership(),
    getSettings(),
    getStateDatabase({ createIfMissing: false }),
  ]);
  const managed = database
    ? await database<{ id: string }[]>`SELECT id FROM automations UNION SELECT id FROM inbox`
    : [];
  const workerSessionParents = { ...workersBefore, ...workersAfter };
  const retainedSessionIds = new Set([
    ...Object.keys(workerSessionParents),
    ...managed.map(({ id }) => id),
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
    workerSessionParents,
  };
}

/** Resolve the role claimed for a Session by application features. */
export async function resolveSessionType(sessionId: string): Promise<SessionType> {
  const database = await getStateDatabase({ createIfMissing: false });
  const row = database
    ? (
        await database<SessionTypeClaims[]>`
          SELECT
            EXISTS(SELECT 1 FROM automations WHERE id = ${sessionId}) AS automation,
            EXISTS(SELECT 1 FROM inbox WHERE id = ${sessionId}) AS inbox,
            EXISTS(SELECT 1 FROM workers WHERE session_id = ${sessionId}) AS worker
        `
      )[0]
    : undefined;

  const types: SessionType[] = [];
  if (row?.automation) types.push("automation");
  if (row?.inbox) types.push("inbox");
  if (hasHyperSession(sessionId)) types.push("hyper");
  if (row?.worker) types.push("worker");

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
  } else if (worker) {
    await unregisterWorkerSession(sessionId);
  }
}

type SessionTypeClaims = {
  automation: number;
  inbox: number;
  worker: number;
};
