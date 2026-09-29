import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { InboxEntry } from "./model";
import { inboxQueries } from "./queries";

export function applyInboxListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  if (event.type === "inbox.changed") {
    void invalidateInboxListQuery(queryClient);
  } else if (event.type === "inbox.entry.deleted") {
    // Cancel an older snapshot before removing the entry so cancellation cannot
    // revert the removal. The replacement read starts after the committed deletion.
    if (queryClient.getQueryState(inboxQueries.listKey())?.fetchStatus === "fetching") {
      void invalidateInboxListQuery(queryClient);
    }
    queryClient.setQueryData<InboxEntry[]>(inboxQueries.listKey(), (entries) =>
      entries?.filter(({ id }) => id !== event.entryId),
    );
  }
}

export async function invalidateInboxListQuery(queryClient: QueryClient): Promise<void> {
  const filter = { queryKey: inboxQueries.listKey(), exact: true };
  // Invalidation alone may reuse an initial fetch with no cached data yet.
  await queryClient.cancelQueries(filter);
  return queryClient.invalidateQueries(filter);
}
