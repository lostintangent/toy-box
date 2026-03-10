import { queryOptions } from "@tanstack/react-query";
import {
  querySession,
  getSessionsState,
  listModels,
  listSessionSkills,
} from "@/functions/sessions";
import type { SessionsState } from "@/functions/sessions";
import { listServerAutomations } from "@/functions/automations";

export type { SessionsState };

export function createEmptySessionsState(): SessionsState {
  return {
    sessions: [],
    streamingSessionIds: [],
    unreadSessionIds: [],
    worktrees: {},
  };
}

/**
 * Query factory for session-related queries.
 *
 * Uses hierarchical keys for easy bulk invalidation:
 * - sessionQueries.all() -> ['sessions'] - invalidates everything
 * - sessionQueries.stateKey() -> ['sessions', 'state'] - sidebar/list state snapshot key
 * - sessionQueries.state() -> query options for the sidebar/list state snapshot
 * - sessionQueries.detail(id) -> ['sessions', 'detail', id] - specific session
 */
export const sessionQueries = {
  // Base key for all session queries - useful for bulk invalidation
  all: () => ["sessions"] as const,

  // Canonical key for unified sidebar/list state
  stateKey: () => [...sessionQueries.all(), "state"] as const,

  // Unified sidebar/list snapshot (sessions + streaming + unread).
  // Keep this query independent from view-local selection state to avoid
  // stale fetches (with different openSessionIds) racing on one cache key.
  state: () =>
    queryOptions({
      queryKey: sessionQueries.stateKey(),
      queryFn: () => getSessionsState({ data: {} }),
      staleTime: Infinity,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    }),

  // Base key for session detail queries
  details: () => [...sessionQueries.all(), "detail"] as const,

  // Single session detail (messages, metadata, etc.)
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

/**
 * Query factory for model-related queries.
 */
export const modelQueries = {
  // Base key for all model queries
  all: () => ["models"] as const,

  // Available models list
  list: () =>
    queryOptions({
      queryKey: modelQueries.all(),
      queryFn: listModels,
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    }),
};

/**
 * Query factory for automation-related queries.
 */
export const automationQueries = {
  all: () => ["automations"] as const,

  list: () =>
    queryOptions({
      queryKey: automationQueries.all(),
      queryFn: listServerAutomations,
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
    queryOptions({
      queryKey: skillQueries.byCwd(cwd),
      queryFn: () => listSessionSkills({ data: { sessionId } }),
      staleTime: Infinity,
    }),
};
