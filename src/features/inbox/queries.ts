import { queryOptions } from "@tanstack/react-query";
import type { SessionsState } from "@sessions/model";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { listInboxEntries } from "./server/functions";

export const inboxQueries = {
  listKey: () => ["inbox", "list"] as const,

  list: () =>
    queryOptions({
      queryKey: inboxQueries.listKey(),
      queryFn: listInboxEntries,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};

/** Result storage and shared activity remain separate; presentation combines them. */
export function sortInboxEntries(entries: InboxEntry[], workspace: WorkspaceState): InboxEntry[] {
  return [...entries].sort(
    (left, right) =>
      Number(isInboxTaskRunning(workspace, right.id)) -
        Number(isInboxTaskRunning(workspace, left.id)) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

export function isInboxTaskRunning(workspace: WorkspaceState, sessionId: string): boolean {
  return (
    workspace.sessionStates[sessionId]?.status === "running" ||
    workspace.workers.some((worker) => worker.sessionId === sessionId)
  );
}

export function selectInboxSessions(state: SessionsState, entries: InboxEntry[]) {
  const inboxIds = new Set(entries.map((entry) => entry.id));
  return state.sessions.filter(
    ({ id }) => state.ownership[id]?.type !== "worker" || inboxIds.has(id),
  );
}
