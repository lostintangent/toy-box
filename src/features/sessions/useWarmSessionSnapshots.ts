/** Holds explicitly pinned session snapshots ready to open. */

import { useQueries } from "@tanstack/react-query";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { sessionQueries } from "./queries";

/** One warm subscription: loads the snapshot if cold, then never refetches. */
export function warmSessionSnapshotQuery(sessionId: string) {
  return {
    ...sessionQueries.detail(sessionId),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

export function useWarmSessionSnapshots(): void {
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);

  useQueries({
    queries: pinnedSessionIds.map(warmSessionSnapshotQuery),
    // These subscriptions render nothing; a stable result keeps the host from
    // rerendering whenever any warm session's snapshot changes.
    combine: () => undefined,
  });
}
