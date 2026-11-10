import { reducedQuery } from "@/shared/query";
import { getWorkspaceState } from "./server/functions";
import { reduceWorkspaceState } from "./model/state/reducer";

/** The canonical SSR and browser query for the shared workspace projection. */
export const workspaceQueries = {
  // The shared SSE connection validates SSR's revision and refreshes after
  // missed updates or reconnects; ordinary live events update this cache.
  state: reducedQuery({
    queryKey: ["workspace", "state"],
    fetch: () => getWorkspaceState(),
    reduce: reduceWorkspaceState,
  }),
};
