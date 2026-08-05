import { queryOptions } from "@tanstack/react-query";
import { querySession, getSessionsState, listModels, listSkills } from "@/functions/sessions";
import type { SessionsState } from "@/functions/sessions";
import type { SessionType } from "@/types";

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
    workerSessionParents: {},
  };
}

/** Preserve worker metadata for linked panes while excluding it from every ordinary list. */
export function selectNonWorkerSessions(state: SessionsState): SessionsState["sessions"] {
  if (Object.keys(state.workerSessionParents).length === 0) return state.sessions;
  return state.sessions.filter(
    ({ sessionId }) => !Object.hasOwn(state.workerSessionParents, sessionId),
  );
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

  byCwd: (cwd?: string, sessionType: SessionType = "standard") =>
    [...skillQueries.all(), cwd ?? null, sessionType] as const,

  list: (cwd?: string, sessionType?: SessionType) =>
    queryOptions({
      queryKey: skillQueries.byCwd(cwd, sessionType),
      queryFn: () => listSkills({ data: { cwd, sessionType } }),
      staleTime: Infinity,
    }),
};
