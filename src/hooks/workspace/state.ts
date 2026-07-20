import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { workspaceQueries } from "@/lib/queries";
import { dispatchWorkspaceAction } from "@/lib/workspace/queryCache";
import { isWorkspaceSessionRunning, type WorkspaceState } from "@/lib/workspace/state";
import type { WorkspaceAction } from "@/types";

type WorkspaceSelector<T> = (workspace: WorkspaceState) => T;

export function useWorkspaceSelector<T>(select: WorkspaceSelector<T>): T {
  return useSuspenseQuery({ ...workspaceQueries.state(), select }).data;
}

export function useWorkspaceSessionRunning(sessionId: string) {
  return useWorkspaceSelector((workspace) =>
    isWorkspaceSessionRunning(workspace.sessionStates[sessionId]),
  );
}

export function selectWorkspaceSessionActivity(workspace: WorkspaceState, sessionId: string) {
  const state = workspace.sessionStates[sessionId];
  return {
    running: isWorkspaceSessionRunning(state),
    unread: state?.status === "unread",
  };
}

export function useWorkspaceSessionActivity(sessionId: string) {
  return useWorkspaceSelector((workspace) => selectWorkspaceSessionActivity(workspace, sessionId));
}

export function selectInboxEntries(workspace: WorkspaceState) {
  return [...workspace.inboxEntries].sort((left, right) => {
    const leftRunning = isWorkspaceSessionRunning(workspace.sessionStates[left.id]);
    const rightRunning = isWorkspaceSessionRunning(workspace.sessionStates[right.id]);
    return (
      Number(rightRunning) - Number(leftRunning) || right.createdAt.localeCompare(left.createdAt)
    );
  });
}

export function useDispatchWorkspaceAction() {
  const queryClient = useQueryClient();

  return (action: WorkspaceAction): void => dispatchWorkspaceAction(queryClient, action);
}
