// Application composition for Session resources governed by another feature.
// Sessions supplies execution and teardown; managing features supply ownership
// and presentation policy without entering the Session kernel.

import type { SessionOwnership, SessionsState } from "@sessions/model";
import { getSessionsActivity } from "@sessions/server/state/activity";
import { workerParentSessionId } from "@workers/model";
import { draftSessionId, type DraftKey } from "@workspace/model/state/drafts";
import { getSavedDrafts } from "@workspace/server/state/drafts";
import { getSettings } from "@workspace/server/state/settings";

const RECENT_SESSION_LIMIT = 250;

/** Read the public Session catalog with feature-owned visibility and relationships. */
export async function readSessionCatalog(source: {
  /** At least each provider's newest `limit` Sessions, plus drafts. */
  list(limit: number): Promise<SessionsState["sessions"]>;
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
  const listedSessions = await source.list(RECENT_SESSION_LIMIT + exemptSessionIds.size);
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
    ownership,
  };
}

/** Resolve a Session's kind from the ownership that makes it one, with the Worker it found. */
export async function resolveSessionType(sessionId: string) {
  const { getWorker } = await import("@workers/server");
  const worker = await getWorker(sessionId);
  if (worker) return { sessionType: "worker", worker } as const;
  const { getAutomation } = await import("@automations/server");
  if (await getAutomation(sessionId)) return { sessionType: "automation" } as const;
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
  const { detachWorker, getWorker } = await import("@workers/server");
  const worker = await getWorker(sessionId);
  if (worker?.type === "channel") {
    const { detachChannelAgentSession } = await import("@channels/server");
    await detachChannelAgentSession(sessionId);
  } else if (worker) await detachWorker(sessionId);
}

async function readSessionOwnership(): Promise<SessionsState["ownership"]> {
  const [{ listAutomations }, { listWorkers }] = await Promise.all([
    import("@automations/server"),
    import("@workers/server"),
  ]);
  const [automations, workers] = await Promise.all([listAutomations(), listWorkers()]);
  const ownership: SessionsState["ownership"] = {};
  const own = (sessionId: string, owner: SessionOwnership) => {
    const previous = ownership[sessionId];
    if (previous) {
      throw new Error(
        `Session ${sessionId} has conflicting types: ${previous.type}, ${owner.type}`,
      );
    }
    ownership[sessionId] = owner;
  };
  for (const { id } of automations) own(id, { type: "automation" });
  for (const worker of workers) {
    own(worker.sessionId, {
      type: "worker",
      parentSessionId: workerParentSessionId(worker) ?? null,
    });
  }
  return ownership;
}
