import type { QueryClient } from "@tanstack/react-query";
import { dispatchWorkspaceAction as requestWorkspaceAction } from "@/functions/workspace";
import { applyWorkspaceEventToSessionQueries } from "@/lib/session/queryCache";
import type { WorkspaceAction, WorkspaceEvent } from "@/types";
import {
  discardBufferedWorkspaceQueryEvents,
  recordWorkspaceQueryEvent,
  workspaceQueries,
} from "./query";
import { reduceWorkspaceState, type WorkspaceState } from "./state";

export function applyWorkspaceEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  recordWorkspaceQueryEvent(queryClient, event);
  applyWorkspaceEventToSessionQueries(queryClient, event);
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), (state) =>
    state ? reduceWorkspaceState(state, event) : state,
  );
}

export function invalidateWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries(
    { queryKey: workspaceQueries.stateKey(), exact: true },
    { throwOnError: true },
  );
}

export function repairWorkspaceStateQuery(queryClient: QueryClient): Promise<void> {
  discardBufferedWorkspaceQueryEvents(queryClient);
  return invalidateWorkspaceStateQuery(queryClient);
}

export function dispatchWorkspaceAction(queryClient: QueryClient, action: WorkspaceAction): void {
  applyWorkspaceEvent(queryClient, action);

  // The server echo is idempotent. A rejected command repairs the optimistic
  // transition from a fresh authoritative snapshot.
  void requestWorkspaceAction({ data: action }).catch((error) => {
    console.error("Failed to dispatch workspace action:", error);
    void repairWorkspaceStateQuery(queryClient).catch((refreshError) => {
      console.error("Failed to refresh workspace state:", refreshError);
    });
  });
}
