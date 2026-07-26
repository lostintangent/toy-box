/**
 * Holds a working set of session snapshots resident in the query cache, so
 * opening one of them renders from cache instead of a round trip.
 *
 * React Query collects a query only once its last observer unsubscribes, so
 * these subscriptions are the retention: entering the set warms a session and
 * leaving it releases the snapshot to the ordinary collection timer. They never
 * refetch on their own, because an open pane's own observer owns freshness.
 */

import { useQueries } from "@tanstack/react-query";
import { sessionQueries } from "@/lib/queries";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import type { SessionMetadata } from "@/types";

/** Recent sessions held ready alongside pinned ones, as the likeliest next open. */
const WARM_RECENT_SESSION_COUNT = 2;

/** The sessions worth holding ready: durable interest, then likeliest next open. */
export function selectWarmSessionIds(
  pinnedSessionIds: readonly string[],
  recentSessions: readonly SessionMetadata[],
): string[] {
  const recentSessionIds = recentSessions
    .slice(0, WARM_RECENT_SESSION_COUNT)
    .map((session) => session.sessionId);
  return [...new Set([...pinnedSessionIds, ...recentSessionIds])];
}

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

/** Warms the pinned sessions plus the most recent of `recentSessions`. */
export function useWarmSessionSnapshots(recentSessions: readonly SessionMetadata[]): void {
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);

  useQueries({
    queries: selectWarmSessionIds(pinnedSessionIds, recentSessions).map(warmSessionSnapshotQuery),
    // These subscriptions render nothing; a stable result keeps the host from
    // rerendering whenever any warm session's snapshot changes.
    combine: () => undefined,
  });
}
