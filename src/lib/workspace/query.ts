import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getWorkspaceState } from "@/functions/workspace";
import type { WorkspaceEvent } from "@/types";
import { reduceWorkspaceState, type WorkspaceState } from "./state";

type ReadWorkspaceState = () => Promise<WorkspaceState>;
type WorkspaceSnapshotRead = { events: WorkspaceEvent[] };

export const workspaceQueries = {
  all: () => ["workspace"] as const,

  stateKey: () => [...workspaceQueries.all(), "state"] as const,

  state: () =>
    queryOptions({
      queryKey: workspaceQueries.stateKey(),
      queryFn: ({ client }) => getWorkspaceQuerySource(client).readSnapshot(getWorkspaceState),
      // The shared SSE connection explicitly invalidates this query after it
      // opens, once no more updates can fall into a reconnect gap.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};

/** Reconciles one QueryClient's snapshot reads with concurrent live events. */
export function createWorkspaceQuerySource() {
  let activeRead: WorkspaceSnapshotRead | undefined;

  function recordEvent(event: WorkspaceEvent): void {
    activeRead?.events.push(event);
  }

  async function readSnapshot(readWorkspaceState: ReadWorkspaceState): Promise<WorkspaceState> {
    // A replacement fetch inherits events from the fetch Query cancelled so
    // reconnect invalidations cannot drop transitions already received.
    const read = { events: activeRead?.events ?? [] };
    activeRead = read;

    try {
      const snapshot = await readWorkspaceState();
      return read.events.reduce(reduceWorkspaceState, snapshot);
    } finally {
      if (activeRead === read) activeRead = undefined;
    }
  }

  function discardBufferedEvents(): void {
    // Mutate the shared buffer so even a request that cannot be cancelled
    // cannot replay a rejected optimistic transition when it resolves.
    if (activeRead) activeRead.events.length = 0;
  }

  return { discardBufferedEvents, readSnapshot, recordEvent };
}

const workspaceQuerySources = new WeakMap<
  QueryClient,
  ReturnType<typeof createWorkspaceQuerySource>
>();

function getWorkspaceQuerySource(queryClient: QueryClient) {
  let source = workspaceQuerySources.get(queryClient);
  if (!source) {
    source = createWorkspaceQuerySource();
    workspaceQuerySources.set(queryClient, source);
  }
  return source;
}

export function recordWorkspaceQueryEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  getWorkspaceQuerySource(queryClient).recordEvent(event);
}

export function discardBufferedWorkspaceQueryEvents(queryClient: QueryClient): void {
  getWorkspaceQuerySource(queryClient).discardBufferedEvents();
}
