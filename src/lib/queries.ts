import { queryOptions } from "@tanstack/react-query";
import {
  querySession,
  getSessionsState,
  listModels,
  listSessionSkills,
} from "@/functions/sessions";
import type { SessionsState } from "@/functions/sessions";
import { getWorkspaceState } from "@/functions/workspace";
import { listAutomations } from "@/functions/automations";

export type { SessionsState };

export const sessionQueries = {
  all: () => ["sessions"] as const,

  stateKey: () => [...sessionQueries.all(), "state"] as const,

  // Durable sidebar/list snapshot. Shared lifecycle and composer state lives
  // in workspaceQueries.state().
  state: () =>
    queryOptions({
      queryKey: sessionQueries.stateKey(),
      queryFn: getSessionsState,
      staleTime: Infinity,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
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
    childSessionIds: [],
  };
}

export const workspaceQueries = {
  all: () => ["workspace"] as const,

  stateKey: () => [...workspaceQueries.all(), "state"] as const,

  state: () =>
    queryOptions({
      queryKey: workspaceQueries.stateKey(),
      queryFn: getWorkspaceState,
      staleTime: Infinity,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    }),
};

export const modelQueries = {
  all: () => ["models"] as const,

  list: () =>
    queryOptions({
      queryKey: modelQueries.all(),
      queryFn: listModels,
      staleTime: 5 * 60_000,
    }),
};

export const automationQueries = {
  all: () => ["automations"] as const,

  list: () =>
    queryOptions({
      queryKey: automationQueries.all(),
      queryFn: listAutomations,
      staleTime: 30_000,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    }),
};

/**
 * Query factory for skill-related queries.
 *
 * Skills are directory-scoped (resolved from .claude/ dirs, plugins, etc.),
 * so queries are keyed by CWD rather than session ID. Multiple sessions in
 * the same directory share a single cache entry. The stream-based
 * `session.skills_loaded` event primes this cache for free on live sessions;
 * the RPC fallback here covers cold sessions that haven't streamed yet.
 */
export const skillQueries = {
  all: () => ["skills"] as const,

  byCwd: (cwd: string) => [...skillQueries.all(), cwd] as const,

  /** Fetch skills via RPC. Requires a sessionId for the SDK handle but caches by CWD. */
  list: (sessionId: string, cwd: string) =>
    // The session ID is only the transport handle; the directory is the cached resource identity.
    // oxlint-disable-next-line @tanstack/query/exhaustive-deps
    queryOptions({
      queryKey: skillQueries.byCwd(cwd),
      queryFn: () => listSessionSkills({ data: { sessionId } }),
      staleTime: Infinity,
    }),
};
