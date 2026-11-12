import { queryOptions } from "@tanstack/react-query";
import { reducedQuery } from "@/shared/query";
import { getServer, getWorkspaceState } from "./server/functions";
import { reduceWorkspaceState } from "./model/state/reducer";

export const workspaceQueries = {
  // The canonical SSR and browser query for the shared workspace projection.
  // The shared SSE connection validates SSR's revision and refreshes after
  // missed updates or reconnects; ordinary live events update this cache.
  state: reducedQuery({
    queryKey: ["workspace", "state"],
    fetch: () => getWorkspaceState(),
    reduce: reduceWorkspaceState,
  }),
  // The server resource, read while Settings is open for the release it runs and the one installed.
  server: queryOptions({ queryKey: ["workspace", "server"], queryFn: () => getServer() }),
};
