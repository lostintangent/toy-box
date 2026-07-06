/**
 * Loads durable session-list data. Workspace coordination state is owned by
 * useWorkspace, not by this hook.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries } from "@/lib/queries";

export function useSessions() {
  const { data, isLoading } = useQuery(sessionQueries.state());
  const sessionsState = data ?? createEmptySessionsState();
  const { sessions: allSessions, worktrees, childSessionIds } = sessionsState;

  const sessions = useMemo(
    () =>
      [...allSessions]
        .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
        .slice(0, 50),
    [allSessions],
  );

  const worktreeSessionIds = useMemo(() => Object.keys(worktrees), [worktrees]);

  return {
    isLoading,
    sessionsState,
    sessions,
    allSessions,
    worktreeSessionIds,
    childSessionIds,
  };
}
