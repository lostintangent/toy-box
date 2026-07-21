import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  dispatchWorkspaceAction as requestWorkspaceAction,
  getWorkspaceState,
  updateSettings as requestSettingsUpdate,
} from "@/functions/workspace";
import { applyWorkspaceEventToSessionQueries } from "@/lib/session/queryCache";
import type { Settings, WorkspaceAction, WorkspaceEvent } from "@/types";
import { areSettingsEqual } from "../config/settings";
import { reduceWorkspaceState, type WorkspaceState } from "./reducer";

/** The canonical SSR and browser query for the shared workspace projection. */
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

export function applyWorkspaceEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  recordWorkspaceQueryEvent(queryClient, event);
  applyWorkspaceEventToSessionQueries(queryClient, event);
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), (state) =>
    state ? reduceWorkspaceState(state, event) : state,
  );
}

export function dispatchWorkspaceAction(queryClient: QueryClient, action: WorkspaceAction): void {
  applyWorkspaceEvent(queryClient, action);

  // The server echo is idempotent. A rejected command repairs the optimistic
  // transition from a fresh authoritative snapshot.
  void requestWorkspaceAction({ data: action }).catch((error) => {
    console.error("Failed to dispatch workspace action:", error);
    void repairWorkspaceStateQuery(queryClient).catch((refreshError) => {
      console.error("Failed to refresh workspace state:", refreshError);
    });
  });
}

export function updateWorkspaceSetting<Key extends keyof Settings>(
  queryClient: QueryClient,
  key: Key,
  value: Settings[Key],
): void {
  const workspace = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!workspace) return;

  const settings = { ...workspace.settings, [key]: value };
  if (areSettingsEqual(workspace.settings, settings)) return;
  applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

  void requestSettingsUpdate({ data: { [key]: value } }).catch((error) => {
    console.error("Failed to update settings:", error);
    void repairWorkspaceStateQuery(queryClient).catch((refreshError) => {
      console.error("Failed to refresh workspace state:", refreshError);
    });
  });
}

export function invalidateWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries(
    { queryKey: workspaceQueries.stateKey(), exact: true },
    { throwOnError: true },
  );
}

type ReadWorkspaceState = () => Promise<WorkspaceState>;
type WorkspaceSnapshotRead = { events: WorkspaceEvent[] };

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

function recordWorkspaceQueryEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  getWorkspaceQuerySource(queryClient).recordEvent(event);
}

function discardBufferedWorkspaceQueryEvents(queryClient: QueryClient): void {
  getWorkspaceQuerySource(queryClient).discardBufferedEvents();
}

function repairWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  discardBufferedWorkspaceQueryEvents(queryClient);
  return invalidateWorkspaceStateQuery(queryClient);
}
