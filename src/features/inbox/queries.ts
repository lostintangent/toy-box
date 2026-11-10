import type { SessionsState } from "@sessions/model";
import type { SessionsActivity } from "@sessions/model/activity";
import type { Worker } from "@workers/model";
import { reducedQuery } from "@/shared/query";
import type { InboxEntry } from "./model";
import { listInboxEntries } from "./server/functions";

export const inboxQueries = {
  // Deleted sessions reduce into the list. Change hints refresh it instead.
  list: reducedQuery({
    queryKey: ["inbox", "list"],
    fetch: ({ signal }) => listInboxEntries({ signal }),
    reduce: (entries: InboxEntry[], { sessionId }: { sessionId: string }) =>
      entries.filter(({ id }) => id !== sessionId),
  }),
};

/** Result storage, shared activity, and admitted work remain separate; presentation combines them. */
export function sortInboxEntries(
  entries: InboxEntry[],
  activities: SessionsActivity,
  workers: readonly Worker[],
): InboxEntry[] {
  const isRunning = (id: string) => isInboxTaskRunning(activities, workers, id);
  return [...entries].sort(
    (left, right) =>
      Number(isRunning(right.id)) - Number(isRunning(left.id)) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

/** A task runs once its session does, and from the moment its Worker is admitted. */
export function isInboxTaskRunning(
  activities: SessionsActivity,
  workers: readonly Worker[],
  sessionId: string,
): boolean {
  return (
    activities[sessionId]?.status === "running" ||
    workers.some((worker) => worker.sessionId === sessionId)
  );
}

export function selectInboxSessions(state: SessionsState, entries: InboxEntry[]) {
  const inboxIds = new Set(entries.map((entry) => entry.id));
  return state.sessions.filter(
    ({ id }) => state.ownership[id]?.type !== "worker" || inboxIds.has(id),
  );
}
