import { queryOptions, skipToken } from "@tanstack/react-query";
import type { SessionsState, SessionType } from "./model";
import {
  getSessionsState,
  listSkills,
  querySession,
  resolveSessionContext,
} from "./server/functions";

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

  context: (directory?: string) =>
    queryOptions({
      queryKey: [...sessionQueries.all(), "context", directory ?? null] as const,
      queryFn: directory ? () => resolveSessionContext({ data: { directory } }) : skipToken,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
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

/** Exclude Worker backing Sessions while preserving their metadata for owning surfaces. */
export function selectNonWorkerSessions(state: SessionsState): SessionsState["sessions"] {
  if (Object.keys(state.workerSessionParents).length === 0) return state.sessions;
  return state.sessions.filter(({ id }) => !Object.hasOwn(state.workerSessionParents, id));
}

/** Cache skills by directory and session type; no directory means host-level discovery. */
export const skillQueries = {
  all: () => ["skills"] as const,

  byCwd: (cwd?: string, sessionType: SessionType = "standard", provider?: string) =>
    [...skillQueries.all(), cwd ?? null, sessionType, provider ?? null] as const,

  list: (cwd?: string, sessionType?: SessionType, provider?: string) =>
    queryOptions({
      queryKey: skillQueries.byCwd(cwd, sessionType, provider),
      queryFn: () => listSkills({ data: { cwd, sessionType, provider } }),
      staleTime: Infinity,
    }),
};
