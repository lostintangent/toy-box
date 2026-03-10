import { queryOptions } from "@tanstack/react-query";
import { querySession, getSessionsBootstrapState, listModels } from "@/functions/sessions";
import { listServerAutomations } from "@/functions/automations";

export type SessionsState = Awaited<ReturnType<typeof getSessionsBootstrapState>>;

export function createEmptySessionsState(): SessionsState {
  return {
    sessions: [],
    streamingSessionIds: [],
    unreadSessionIds: [],
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
      queryFn: () => getSessionsBootstrapState({ data: {} }),
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
