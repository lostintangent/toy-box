import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { workspaceStateAtom, workspaceHydratedAtom } from "@/atoms";
import { dispatchWorkspaceAction as dispatchWorkspaceActionOnServer } from "@/functions/sessions";
import { useServerEvents } from "@/hooks/events/useServerEvents";
import { workspaceQueries } from "@/lib/queries";
import { createEmptyWorkspaceState, reduceWorkspaceState } from "@/lib/workspace/state";
import {
  syncSessionQueriesFromWorkspaceEvent,
  invalidateSessionsState,
} from "@/lib/session/queryCache";
import type { WorkspaceAction, WorkspaceEvent } from "@/types";

type UseWorkspaceOptions = {
  openSessionIds: string[];
};

export type WorkspaceActions = {
  applyWorkspaceEvent: (event: WorkspaceEvent) => void;
  dispatchWorkspaceAction: (action: WorkspaceAction) => Promise<void>;
};

export function useWorkspace({ openSessionIds }: UseWorkspaceOptions) {
  const queryClient = useQueryClient();
  const workspaceState = useAtomValue(workspaceStateAtom);
  const setWorkspaceState = useSetAtom(workspaceStateAtom);
  const [workspaceHydrated, setWorkspaceHydrated] = useAtom(workspaceHydratedAtom);

  // Live events that arrive before the store reflects the latest server snapshot
  // are held here and replayed onto it once it lands — applying them sooner would
  // lose them when the snapshot overwrites the store. `null` once the store is
  // live, meaning subsequent events apply directly.
  const pendingEventsRef = useRef<WorkspaceEvent[] | null>([]);

  // Reduce an event into the workspace atom only. Used to replay held events,
  // whose durable-cache sync already ran before hydration.
  const applyToAtom = useCallback(
    (event: WorkspaceEvent) => {
      setWorkspaceState((state) => reduceWorkspaceState(state, event));
    },
    [setWorkspaceState],
  );

  // Apply an inbound event everywhere it belongs: the durable React Query
  // sessions-list cache (a no-op for all but upserted/deleted) and the atom.
  const applyWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      syncSessionQueriesFromWorkspaceEvent(queryClient, event);
      applyToAtom(event);
    },
    [applyToAtom, queryClient],
  );

  const refetchWorkspaceState = useCallback(() => {
    // Hold events again until the fresh snapshot lands, keeping any already held.
    pendingEventsRef.current ??= [];
    void queryClient.invalidateQueries({ queryKey: workspaceQueries.stateKey() });
  }, [queryClient]);

  const dispatchWorkspaceAction = useCallback(
    async (action: WorkspaceAction) => {
      applyWorkspaceEvent(action);

      // The optimistic reduction already matches what the server will broadcast, so
      // a resolved dispatch needs no follow-up. Only a thrown error means the action
      // may not have applied — resync from the authoritative snapshot in that case.
      try {
        await dispatchWorkspaceActionOnServer({ data: action });
      } catch (error) {
        console.error("Failed to dispatch workspace action:", error);
        refetchWorkspaceState();
      }
    },
    [applyWorkspaceEvent, refetchWorkspaceState],
  );

  const actions = useMemo(
    () => ({ applyWorkspaceEvent, dispatchWorkspaceAction }),
    [applyWorkspaceEvent, dispatchWorkspaceAction],
  );

  const handleWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (pendingEventsRef.current) {
        syncSessionQueriesFromWorkspaceEvent(queryClient, event);
        pendingEventsRef.current.push(event);
        return;
      }

      applyWorkspaceEvent(event);
    },
    [applyWorkspaceEvent, queryClient],
  );

  const handleReconnect = useCallback(() => {
    refetchWorkspaceState();
    void invalidateSessionsState(queryClient);
  }, [queryClient, refetchWorkspaceState]);

  useServerEvents({
    namespace: "session",
    onEvent: handleWorkspaceEvent,
    onReconnect: handleReconnect,
  });

  const { data, dataUpdatedAt, isLoading } = useQuery(workspaceQueries.state());
  // SSR and the first client render can see React Query data before effects copy
  // it into the atom. Once the store is hydrated it owns optimistic/live updates.
  const effectiveWorkspaceState = workspaceHydrated
    ? workspaceState
    : (data ?? createEmptyWorkspaceState());

  useEffect(() => {
    if (!data) return;

    setWorkspaceState(data);
    setWorkspaceHydrated(true);
    for (const event of pendingEventsRef.current ?? []) {
      applyToAtom(event);
    }
    pendingEventsRef.current = null;
  }, [applyToAtom, data, dataUpdatedAt, setWorkspaceState, setWorkspaceHydrated]);

  useEffect(() => {
    for (const sessionId of openSessionIds) {
      if (!effectiveWorkspaceState.unreadSessionIds.includes(sessionId)) continue;
      void dispatchWorkspaceAction({ type: "session.read", sessionId });
    }
  }, [dispatchWorkspaceAction, effectiveWorkspaceState.unreadSessionIds, openSessionIds]);

  return {
    isLoading,
    workspaceState: effectiveWorkspaceState,
    drafts: effectiveWorkspaceState.drafts,
    draftPromptsBySessionId: effectiveWorkspaceState.draftPromptsBySessionId,
    hyperSessionIds: effectiveWorkspaceState.hyperSessionIds,
    runningSessionIds: effectiveWorkspaceState.runningSessionIds,
    unreadSessionIds: effectiveWorkspaceState.unreadSessionIds,
    dispatchWorkspaceAction,
    actions,
  };
}
