import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** After a live change is written into a query's data, a read of it already in flight may predate
 *  the change and overwrite it, so replace that read with one that starts after. */
export function replaceOverlappingRead(queryClient: QueryClient, queryKey: QueryKey): void {
  if (queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") {
    void queryClient.refetchQueries({ queryKey, exact: true });
  }
}

/**
 * A snapshot query that live events keep current by reducing into its data. A read can begin
 * before an event and resolve after it, so each read journals the events applied meanwhile and
 * reduces them over the snapshot it returns: a slow read never overwrites a newer event.
 */
export function snapshotJournal<State, Event>(
  queryKey: QueryKey,
  reduce: (state: State, event: Event) => State,
) {
  // One active read per QueryClient, so each client's journal stays its own.
  const activeReads = new WeakMap<QueryClient, { events: Event[] }>();

  /** Read a snapshot reconciled with every event applied while it was in flight. */
  async function read(queryClient: QueryClient, readSnapshot: () => Promise<State>) {
    // A replacement read inherits events from the read Query cancelled, so a reconnect's
    // refresh cannot drop transitions already received.
    const read = { events: activeReads.get(queryClient)?.events ?? [] };
    activeReads.set(queryClient, read);
    try {
      const snapshot = await readSnapshot();
      return read.events.reduce(reduce, snapshot);
    } finally {
      if (activeReads.get(queryClient) === read) activeReads.delete(queryClient);
    }
  }

  /** Apply a live, optimistic, or confirmed event to the cached snapshot. */
  function apply(queryClient: QueryClient, event: Event): void {
    activeReads.get(queryClient)?.events.push(event);
    queryClient.setQueryData<State>(queryKey, (state) => (state ? reduce(state, event) : state));
  }

  /** Read a fresh snapshot after events may have been missed. */
  async function refresh(queryClient: QueryClient): Promise<void> {
    // invalidateQueries alone can reuse an initial fetch that has no cached data yet.
    await queryClient.cancelQueries({ queryKey, exact: true });
    return queryClient.invalidateQueries({ queryKey, exact: true });
  }

  /** Drop a rejected optimistic event, then read a fresh authoritative snapshot. */
  function repair(queryClient: QueryClient): Promise<void> {
    // Clear the shared buffer so even a read that cannot be cancelled cannot replay the
    // rejected event when it resolves.
    const read = activeReads.get(queryClient);
    if (read) read.events.length = 0;
    return refresh(queryClient);
  }

  return { read, apply, refresh, repair };
}
