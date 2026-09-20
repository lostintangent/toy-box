import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  dispatchWorkspaceAction as requestWorkspaceAction,
  getWorkspaceState,
  updateSettings as requestSettingsUpdate,
} from "./server/functions";
import {
  applyWorkspaceEventToSessionQueries,
  invalidateSessionsStateQuery,
} from "@sessions/queryCache";
import { providerQueries } from "@providers/queries";
import { applyChannelListEvent } from "@channels/queryCache";
import { areSettingsEqual, type Settings } from "./model/config/settings";
import type { WorkspaceEvent } from "./model/events";
import type { WorkspaceAction } from "./model/state/actions";
import { reduceWorkspaceState, type WorkspaceState } from "./model/state/reducer";

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
  const disabledProviders = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey())
    ?.settings.disabledProviders;
  recordWorkspaceQueryEvent(queryClient, event);
  applyWorkspaceEventToSessionQueries(queryClient, event);
  applyChannelListEvent(queryClient, event);
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), (state) =>
    state ? reduceWorkspaceState(state, event) : state,
  );
  if (
    event.type === "settings.changed" &&
    (disabledProviders?.length !== event.settings.disabledProviders.length ||
      disabledProviders.some((id) => !event.settings.disabledProviders.includes(id)))
  ) {
    void queryClient.invalidateQueries({ queryKey: providerQueries.all() });
    void invalidateSessionsStateQuery(queryClient);
  }
}

export function dispatchWorkspaceAction(queryClient: QueryClient, action: WorkspaceAction): void {
  applyWorkspaceEvent(queryClient, action);

  // The server echo is idempotent. A rejected command repairs the optimistic
  // transition from a fresh authoritative snapshot.
  void requestWorkspaceAction({ data: action }).catch(() => repairWorkspaceStateQuery(queryClient));
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
  // Catalog reads use persisted availability. Publish this preference after the
  // save so a refetch cannot cache the old provider selection indefinitely.
  if (key !== "disabledProviders")
    applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

  void requestSettingsUpdate({ data: { [key]: value } })
    .then((settings) => {
      if (key === "disabledProviders")
        applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });
    })
    .catch(() => repairWorkspaceStateQuery(queryClient));
}

export function invalidateWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workspaceQueries.stateKey(), exact: true });
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

export function repairWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  discardBufferedWorkspaceQueryEvents(queryClient);
  return invalidateWorkspaceStateQuery(queryClient);
}
