/**
 * Loads durable session-list data. Workspace coordination state is owned by
 * the workspace Query cache, not by this hook.
 */

import { useQuery } from "@tanstack/react-query";
import { createEmptySessionsState, selectNonWorkerSessions, sessionQueries } from "@/lib/queries";

export function useSessions() {
  const { data, isLoading } = useQuery(sessionQueries.state());
  const state = data ?? createEmptySessionsState();
  const { worktrees } = state;

  const worktreeSessionIds = Object.keys(worktrees);

  return {
    isLoading,
    sessions: selectNonWorkerSessions(state),
    worktreeSessionIds,
  };
}
