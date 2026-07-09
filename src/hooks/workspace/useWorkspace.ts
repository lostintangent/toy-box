import { useEffect, useLayoutEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { dispatchWorkspaceAction as dispatchWorkspaceActionOnServer } from "@/functions/workspace";
import { useServerEvents } from "@/hooks/events/useServerEvents";
import { workspaceQueries } from "@/lib/queries";
import { createEmptyWorkspaceState, reduceWorkspaceState } from "@/lib/workspace/state";
import {
  applyWorkspaceEventToSessionQueries,
  invalidateSessionsStateQuery,
} from "@/lib/session/queryCache";
import type { WorkspaceAction, WorkspaceEvent } from "@/types";
import { workspaceStateAtom } from "./atoms";

const EMPTY_WORKSPACE = createEmptyWorkspaceState();

export function useWorkspace() {
  const queryClient = useQueryClient();
  const { data, dataUpdatedAt, isFetching, isLoading } = useQuery(workspaceQueries.state());
  useHydrateAtoms([[workspaceStateAtom, data ?? EMPTY_WORKSPACE]]);
  const setWorkspaceState = useSetAtom(workspaceStateAtom);

  // Record events while an authoritative snapshot is in flight so they can be
  // replayed over it. `null` means no snapshot can overwrite the live atom.
  const eventsDuringFetchRef = useRef<WorkspaceEvent[] | null>([]);
  useLayoutEffect(() => {
    if (isFetching && eventsDuringFetchRef.current === null) {
      eventsDuringFetchRef.current = [];
    }
  }, [isFetching]);

  function applyWorkspaceEvent(event: WorkspaceEvent) {
    applyWorkspaceEventToSessionQueries(queryClient, event);
    eventsDuringFetchRef.current?.push(event);
    setWorkspaceState((state) => reduceWorkspaceState(state, event));
  }

  function refetchWorkspaceState() {
    if (eventsDuringFetchRef.current === null) eventsDuringFetchRef.current = [];
    void queryClient.invalidateQueries({ queryKey: workspaceQueries.stateKey() });
  }

  function dispatchWorkspaceAction(action: WorkspaceAction) {
    applyWorkspaceEvent(action);

    // The server echo is idempotent. A failed dispatch is the only case that
    // needs an authoritative snapshot to undo the optimistic transition.
    void dispatchWorkspaceActionOnServer({ data: action }).catch((error) => {
      console.error("Failed to dispatch workspace action:", error);
      eventsDuringFetchRef.current = [];
      refetchWorkspaceState();
    });
  }

  function handleServerOpen() {
    refetchWorkspaceState();
    void invalidateSessionsStateQuery(queryClient);
  }

  useServerEvents({
    topic: "workspace",
    onEvent: applyWorkspaceEvent,
    onOpen: handleServerOpen,
  });

  useEffect(() => {
    if (!data) return;

    const eventsDuringFetch = eventsDuringFetchRef.current;
    eventsDuringFetchRef.current = null;
    setWorkspaceState(eventsDuringFetch?.reduce(reduceWorkspaceState, data) ?? data);
  }, [data, dataUpdatedAt, setWorkspaceState]);

  const actions = { applyWorkspaceEvent, dispatchWorkspaceAction };

  return {
    isLoading,
    actions,
  };
}
