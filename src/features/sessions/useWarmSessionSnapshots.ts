/** Holds explicitly pinned session snapshots ready to open. */

import { useEffect } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { DESKTOP_VIEWPORT_QUERY } from "@/shared/hooks/useViewport";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { sessionQueries } from "./queries";

/** Retains a pinned session's cached snapshot. It never watches the session, so it
 *  never keeps the session's subscription running. */
export function warmSessionSnapshotQuery(sessionId: string) {
  return { ...sessionQueries.detail(sessionId), enabled: false };
}

export function useWarmSessionSnapshots(): void {
  const queryClient = useQueryClient();
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);
  // The server fallback is false, so hydration cannot start desktop downloads on mobile.
  const isDesktop = useMediaQuery(DESKTOP_VIEWPORT_QUERY);

  useQueries({
    queries: pinnedSessionIds.map(warmSessionSnapshotQuery),
    // These subscriptions render nothing; a stable result keeps the host from
    // rerendering whenever any warm session's snapshot changes.
    combine: () => undefined,
  });

  // Only desktop reads a pinned snapshot before its pane opens. With nothing
  // watching the session, its subscription ends once it brings the snapshot current.
  useEffect(() => {
    if (!isDesktop) return;
    for (const sessionId of pinnedSessionIds) {
      void queryClient.prefetchQuery({ ...sessionQueries.detail(sessionId), staleTime: Infinity });
    }
  }, [isDesktop, pinnedSessionIds, queryClient]);
}
