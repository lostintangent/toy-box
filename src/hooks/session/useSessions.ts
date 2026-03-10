/**
 * Manages the global session state, listens for real-time updates,
 * and also automatically marks open sessions as read.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { markSessionAsRead } from "@/functions/sessions";
import { useServerEvents } from "@/hooks/events/useServerEvents";
import { createEmptySessionsState, sessionQueries } from "@/lib/queries";
import {
  applySessionsUpdateEvent,
  invalidateSessionsState,
  setSessionUnread,
} from "@/lib/session/sessionsCache";
import type { SessionsUpdateEvent } from "@/types";

type UseSessionsOptions = {
  openSessionIds: string[];
};

export function useSessions({ openSessionIds }: UseSessionsOptions) {
  /* Load session state and metadata for sidebar listing */
  const { data, isLoading } = useQuery(sessionQueries.state());
  const {
    sessions: allSessions,
    streamingSessionIds,
    unreadSessionIds,
  } = data ?? createEmptySessionsState();

  const sessions = useMemo(
    () =>
      [...allSessions!]
        .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
        .slice(0, 50),
    [allSessions],
  );

  const queryClient = useQueryClient();

  /* Mark sessions as read whenever they're open */

  useEffect(() => {
    openSessionIds
      .filter((id) => unreadSessionIds.includes(id))
      .forEach((sessionId) => {
        setSessionUnread(queryClient, sessionId, false);
        markSessionAsRead({ data: { sessionId } });
      });
  }, [openSessionIds, unreadSessionIds, queryClient]);

  /* Handle SSE session updates */

  const handleServerEvent = useCallback(
    (event: SessionsUpdateEvent) => applySessionsUpdateEvent(queryClient, event),
    [queryClient],
  );

  const handleServerReconnect = useCallback(
    () => invalidateSessionsState(queryClient),
    [queryClient],
  );

  useServerEvents({
    namespace: "session",
    onEvent: handleServerEvent,
    onReconnect: handleServerReconnect,
  });

  return {
    isLoading,
    sessions,
    allSessions, // Unfiltered list

    streamingSessionIds,
    unreadSessionIds,
  };
}
