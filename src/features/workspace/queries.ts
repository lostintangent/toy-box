import { queryOptions } from "@tanstack/react-query";
import { snapshotJournal } from "@/shared/query";
import { getWorkspaceState } from "./server/functions";
import { reduceWorkspaceState } from "./model/state/reducer";

/** The canonical SSR and browser query for the shared workspace projection. */
export const workspaceQueries = {
  all: () => ["workspace"] as const,

  stateKey: () => [...workspaceQueries.all(), "state"] as const,

  state: () =>
    queryOptions({
      queryKey: workspaceQueries.stateKey(),
      queryFn: ({ client }) => workspaceJournal.read(client, getWorkspaceState),
      // The shared SSE connection validates SSR's revision and refreshes after
      // missed updates or reconnects; ordinary live events update this cache.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};

/** Reconciles the workspace snapshot with live events. */
export const workspaceJournal = snapshotJournal(workspaceQueries.stateKey(), reduceWorkspaceState);
