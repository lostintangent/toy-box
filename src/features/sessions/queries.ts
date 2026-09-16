import { queryOptions, skipToken } from "@tanstack/react-query";
import type { SessionsState, SessionType } from "./model";
import {
  getSessionsState,
  listModels,
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

const projectsSessionListMetadataByType = {
  standard: true,
  automation: true,
  inbox: true,
  hyper: true,
  worker: true,
  agent: false,
} satisfies Record<SessionType, boolean>;

/** Whether this role is deliberately addressable through shared Session metadata. */
export function projectsSessionListMetadata(sessionType: SessionType): boolean {
  return projectsSessionListMetadataByType[sessionType];
}

/** Exclude Worker backing Sessions while preserving their metadata for owning surfaces. */
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
