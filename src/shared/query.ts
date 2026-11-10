import {
  queryOptions,
  type QueryClient,
  type QueryFunctionContext,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * A snapshot query that live events keep current by reducing into its data. A read can begin
 * before an event and resolve after it, so each read journals the events applied meanwhile and
 * reduces them over the snapshot it returns: a slow read never overwrites a newer event. Events
 * keep the data current, so it is never stale and stays resident while unobserved.
 */
export function reducedQuery<State, Event, const Key extends QueryKey>({
  queryKey,
  fetch,
  reduce,
}: {
  queryKey: Key;
  fetch: (context: { signal: AbortSignal }) => Promise<State>;
  reduce: (state: State, event: Event) => State;
}) {
  // One active read per QueryClient, so each client's journal stays its own.
  const activeReads = new WeakMap<QueryClient, { events: Event[] }>();

  /**
   * Read a snapshot reconciled with every event applied while it was in flight. The context
   * passes through whole, so only a fetch that reads its signal lets Query abort it.
   */
  async function read(context: QueryFunctionContext<Key>): Promise<State> {
    const { client } = context;
    // A replacement read inherits events from the read Query cancelled, so a reconnect's
    // refresh cannot drop transitions already received.
    const read = { events: activeReads.get(client)?.events ?? [] };
    activeReads.set(client, read);
    try {
      const snapshot = await fetch(context);
      return read.events.reduce(reduce, snapshot);
    } finally {
      if (activeReads.get(client) === read) activeReads.delete(client);
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
    // The replacement read inherits this buffer, so empty it in place rather than dropping it.
    const read = activeReads.get(queryClient);
    if (read) read.events.length = 0;
    return refresh(queryClient);
  }

  const query = queryOptions({
    queryKey,
    queryFn: read,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { ...query, apply, refresh, repair };
}
