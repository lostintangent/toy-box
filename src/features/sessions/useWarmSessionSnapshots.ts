/** Holds explicitly pinned session snapshots ready to open. */

import { useQueries } from "@tanstack/react-query";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { DESKTOP_VIEWPORT_QUERY } from "@/shared/hooks/useViewport";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { sessionQueries } from "./queries";

/** Retains cached snapshots everywhere; only desktop loads them before opening a pane. */
export function warmSessionSnapshotQuery(sessionId: string, enabled: boolean) {
  return {
    ...sessionQueries.detail(sessionId),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

export function useWarmSessionSnapshots(): void {
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);
  // The server fallback is false, so hydration cannot start desktop downloads on mobile.
  const isDesktop = useMediaQuery(DESKTOP_VIEWPORT_QUERY);

  useQueries({
    queries: pinnedSessionIds.map((sessionId) => warmSessionSnapshotQuery(sessionId, isDesktop)),
    // These subscriptions render nothing; a stable result keeps the host from
    // rerendering whenever any warm session's snapshot changes.
    combine: () => undefined,
  });
}
