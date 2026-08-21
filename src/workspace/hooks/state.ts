import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  dispatchWorkspaceAction,
  updateWorkspaceSetting,
  workspaceQueries,
} from "@workspace/queries";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { Settings } from "../model/config/settings";
import type { WorkspaceAction } from "../model/state/actions";

type WorkspaceSelector<T> = (workspace: WorkspaceState) => T;

export function useWorkspaceSelector<T>(select: WorkspaceSelector<T>): T {
  return useSuspenseQuery({ ...workspaceQueries.state(), select }).data;
}

export function useWorkspaceSessionRunning(sessionId: string) {
  return useWorkspaceSelector(
    (workspace) => workspace.sessionStates[sessionId]?.status === "running",
  );
}

export function selectWorkspaceSessionActivity(workspace: WorkspaceState, sessionId: string) {
  const state = workspace.sessionStates[sessionId];
  return {
    running: state?.status === "running",
    waiting: state?.status === "waiting",
    unread: state?.status === "unread",
    hasDraftPrompt: Boolean(state?.prompt?.text.trim()),
  };
}

export function useWorkspaceSessionActivity(sessionId: string) {
  return useWorkspaceSelector((workspace) => selectWorkspaceSessionActivity(workspace, sessionId));
}

export function useDispatchWorkspaceAction() {
  const queryClient = useQueryClient();

  return (action: WorkspaceAction): void => dispatchWorkspaceAction(queryClient, action);
}

export function useUpdateWorkspaceSetting() {
  const queryClient = useQueryClient();

  return <Key extends keyof Settings>(key: Key, value: Settings[Key]): void =>
    updateWorkspaceSetting(queryClient, key, value);
}
