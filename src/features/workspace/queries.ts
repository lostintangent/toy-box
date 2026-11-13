import { queryOptions } from "@tanstack/react-query";
import { reducedQuery } from "@/shared/query";
import { getLinkedServer, getWorkspaceState } from "./server/functions";
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
  // A linked server's name and release, read through this server since a browser can't read
  // another origin. A read is already bounded, so one attempt shows a sleeping server at once.
  linkedServer: (link: string) =>
    queryOptions({
      queryKey: ["workspace", "linkedServer", link],
      queryFn: () => getLinkedServer({ data: link }),
      retry: false,
    }),
};
