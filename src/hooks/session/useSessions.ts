/**
 * Loads durable session-list data. Workspace coordination state is owned by
 * useWorkspace, not by this hook.
 */

import { useQuery } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries } from "@/lib/queries";

export function useSessions() {
  const { data, isLoading } = useQuery(sessionQueries.state());
  const { sessions, worktrees, childSessionIds } = data ?? createEmptySessionsState();

  const recentSessions = [...sessions]
    .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
    .slice(0, 50);

  const worktreeSessionIds = Object.keys(worktrees);

  return {
    isLoading,
    sessions,
    recentSessions,
    worktreeSessionIds,
    childSessionIds,
  };
}
