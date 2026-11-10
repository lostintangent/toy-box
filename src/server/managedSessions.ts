// Application composition for Session resources governed by another feature.
// Sessions supplies execution and teardown; managing features supply ownership
// and presentation policy without entering the Session kernel.

import type { SessionOwnership, SessionsState } from "@sessions/model";
import { getSessionsActivity } from "@sessions/server/state/activity";
import { getPersistedWorker, unregisterWorkerSession } from "@workers/server/database";
import { getStateDatabase } from "@/server/database";
import { draftSessionId, type DraftKey } from "@workspace/model/state/drafts";
import { getSavedDrafts } from "@workspace/server/state/drafts";
import { getSettings } from "@workspace/server/state/settings";

const RECENT_SESSION_LIMIT = 250;

/** Read the public Session catalog with feature-owned visibility and relationships. */
export async function readSessionCatalog(source: {
  /** At least each provider's newest `limit` Sessions, plus drafts. */
  list(limit: number): Promise<[SessionsState["sessions"], SessionsState["worktrees"]]>;
  /** The Sessions with these public IDs, omitting any that no longer exist. */
  find(sessionIds: string[]): Promise<SessionsState["sessions"]>;
}): Promise<SessionsState> {
  // Ownership precedes SDK creation and outlives SDK deletion. Read it on both
  // sides so a concurrent change cannot expose a backing Session as ordinary.
  const [ownershipBefore, settings] = await Promise.all([readSessionOwnership(), getSettings()]);
  const exemptSessionIds = new Set([
    ...Object.keys(ownershipBefore),
    ...settings.pinnedSessionIds,
    ...(settings.hyperSessionId ? [settings.hyperSessionId] : []),
  ]);
  // Fewer than 250 ordinary Sessions precede any of the newest 250, so each lies
  // within its own provider's newest 250 plus the exempt Sessions.
  const [listedSessions, worktrees] = await source.list(
    RECENT_SESSION_LIMIT + exemptSessionIds.size,
  );
  const ownershipAfter = await readSessionOwnership();
  const ownership = { ...ownershipBefore, ...ownershipAfter };
  const retainedSessionIds = new Set([...exemptSessionIds, ...Object.keys(ownershipAfter)]);
  // Managed sessions and pins do not consume the ordinary-history budget.
  const recentSessions = listedSessions
    .filter(({ id }) => !retainedSessionIds.has(id))
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
    )
    .slice(0, RECENT_SESSION_LIMIT);
  for (const { id } of recentSessions) retainedSessionIds.add(id);
  for (const id of Object.keys(getSessionsActivity())) retainedSessionIds.add(id);
  // Unsent drafts keep their sessions in the catalog, like live and unread work.
  for (const [key, draft] of Object.entries(getSavedDrafts())) {
    const sessionId = draftSessionId(key as DraftKey);
    if (sessionId && draft?.text.trim()) retainedSessionIds.add(sessionId);
  }
  const listedSessionIds = new Set(listedSessions.map(({ id }) => id));
  const sessions = [
    ...listedSessions,
    ...(await source.find([...retainedSessionIds].filter((id) => !listedSessionIds.has(id)))),
  ];
  return {
    sessions: sessions.filter(({ id, provider }) => retainedSessionIds.has(id) || !provider),
    worktrees,
    ownership,
  };
}

/** Resolve a Session's kind from the ownership that makes it one, with the Worker it found. */
export async function resolveSessionType(sessionId: string) {
  const worker = await getPersistedWorker(sessionId);
  if (worker) return { sessionType: "worker", worker } as const;
  const database = await getStateDatabase();
  const [automation] = await database`SELECT 1 FROM automations WHERE id = ${sessionId}`;
  if (automation) return { sessionType: "automation" } as const;
  const { hyperSessionId } = await getSettings();
  return { sessionType: hyperSessionId === sessionId ? "hyper" : "standard" } as const;
}

/** Delete the managed Session resources owned by one Session before its own teardown. */
export async function deleteOwnedSessions(sessionId: string): Promise<void> {
  const { deleteWorkersForSession } = await import("@workers/server");
  await deleteWorkersForSession(sessionId);
}

/** Remove feature ownership after the shared Session resource is gone. */
export async function detachManagedSession(sessionId: string): Promise<void> {
  const worker = await getPersistedWorker(sessionId);
  if (worker?.type === "channel") {
    const { detachChannelAgentSession } = await import("@channels/server");
    await detachChannelAgentSession(sessionId);
  } else if (worker) await unregisterWorkerSession(sessionId);
  // Pending work registered for or under the session ends with it.
  const { finishWorkersForSession } = await import("@workers/server/registry");
  finishWorkersForSession(sessionId);
}

async function readSessionOwnership(): Promise<SessionsState["ownership"]> {
  const database = await getStateDatabase();
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
