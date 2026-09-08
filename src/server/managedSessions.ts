// Application composition for Session resources governed by another feature.
// Sessions supplies execution and teardown; managing features supply ownership
// and presentation policy without entering the Session kernel.

import type { SessionsState, SessionType } from "@sessions/model";
import { getStateDatabase } from "@/server/database";
import { hasHyperSession } from "@workspace/server/state/hyperSessions";

type DeleteSession = (sessionId: string) => Promise<void>;
/** Read the public Session catalog with feature-owned visibility and relationships. */
export async function readSessionCatalog(
  readCatalog: () => Promise<[SessionsState["sessions"], SessionsState["worktrees"]]>,
): Promise<SessionsState> {
  const [{ listAgentSessionIds }, { getWorkerSessionParents }] = await Promise.all([
    import("@agents/server"),
    import("@workers/server/database"),
  ]);
  const readOwnership = () => Promise.all([listAgentSessionIds(), getWorkerSessionParents()]);
  // Ownership precedes SDK creation and outlives SDK deletion. Read it on both
  // sides so a concurrent change cannot expose a backing Session as ordinary.
  const [agentsBefore, workersBefore] = await readOwnership();
  const [sessions, worktrees] = await readCatalog();
  const [agentsAfter, workersAfter] = await readOwnership();
  const unlisted = new Set([...agentsBefore, ...agentsAfter]);
  return {
    sessions: sessions.filter(({ sessionId }) => !unlisted.has(sessionId)),
    worktrees: Object.fromEntries(
      Object.entries(worktrees).filter(([sessionId]) => !unlisted.has(sessionId)),
    ),
    workerSessionParents: { ...workersBefore, ...workersAfter },
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
            EXISTS(SELECT 1 FROM workers WHERE session_id = ${sessionId}) AS worker,
            EXISTS(SELECT 1 FROM agent_memberships WHERE session_id = ${sessionId}) AS agent
        `
      )[0]
    : undefined;

  const types: SessionType[] = [];
  if (row?.automation) types.push("automation");
  if (row?.inbox) types.push("inbox");
  if (hasHyperSession(sessionId)) types.push("hyper");
  if (row?.worker) types.push("worker");
  if (row?.agent) types.push("agent");

  if (types.length > 1) {
    throw new Error(`Session ${sessionId} has conflicting types: ${types.join(", ")}`);
  }
  return types[0] ?? "standard";
}

/** Delete the managed Session resources owned by one Session before its own teardown. */
export async function deleteOwnedSessions(
  sessionId: string,
  deleteSession: DeleteSession,
): Promise<void> {
  const [{ listSessionOwnedAgentSessionIds }, { deleteWorkersForSession }] = await Promise.all([
    import("@agents/server"),
    import("@workers/server"),
  ]);
  for (const childSessionId of await listSessionOwnedAgentSessionIds(sessionId)) {
    await deleteSession(childSessionId);
  }
  await deleteWorkersForSession(sessionId);
}

/** Remove feature ownership after the shared Session resource is gone. */
export async function detachManagedSession(sessionId: string): Promise<void> {
  const [{ unregisterWorkerSession }, { detachAgentSession }] = await Promise.all([
    import("@workers/server/database"),
    import("@agents/server/supervisor"),
  ]);
  await unregisterWorkerSession(sessionId);
  await detachAgentSession(sessionId);
}

type SessionTypeClaims = {
  automation: number;
  inbox: number;
  worker: number;
  agent: number;
};
