import { queryOptions } from "@tanstack/react-query";
import { querySession, getSessionsState, listModels, listSkills } from "@/functions/sessions";
import type { SessionsState } from "@/functions/sessions";

export type { SessionsState };
export const sessionQueries = {
  all: () => ["sessions"] as const,

  stateKey: () => [...sessionQueries.all(), "state"] as const,

  // Durable sidebar/list snapshot. Shared lifecycle and composer state lives
  // in the workspace state query.
  state: () =>
    queryOptions({
      queryKey: sessionQueries.stateKey(),
      queryFn: getSessionsState,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),

  details: () => [...sessionQueries.all(), "detail"] as const,

  detail: (sessionId: string) =>
    queryOptions({
      queryKey: [...sessionQueries.details(), sessionId] as const,
      queryFn: () => querySession({ data: { sessionId } }),
      staleTime: 0, // Always refetch when entering a session to get latest messages
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
      retry: false, // Don't retry on "session not found" errors
    }),
};

export function createEmptySessionsState(): SessionsState {
  return {
    sessions: [],
    worktrees: {},
    workerSessionIds: [],
  };
}

export const modelQueries = {
  all: () => ["models"] as const,

  list: () =>
    queryOptions({
      queryKey: modelQueries.all(),
      queryFn: listModels,
      staleTime: 5 * 60_000,
    }),
};

/**
 * Query factory for skill-related queries.
 *
 * Skills are resolved for a CWD, with null representing host-level discovery
 * when no meaningful directory is selected. Multiple sessions in the same
 * scope share a single cache entry.
 */
export const skillQueries = {
  all: () => ["skills"] as const,

  byCwd: (cwd?: string) => [...skillQueries.all(), cwd ?? null] as const,

  list: (cwd?: string) =>
    queryOptions({
      queryKey: skillQueries.byCwd(cwd),
      queryFn: () => listSkills({ data: { cwd } }),
      staleTime: Infinity,
    }),
};
