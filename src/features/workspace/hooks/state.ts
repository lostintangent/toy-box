import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { updateWorkspaceSetting } from "@workspace/mutations";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { Settings } from "../model/config/settings";

type WorkspaceSelector<T> = (workspace: WorkspaceState) => T;

export function useWorkspaceSelector<T>(select: WorkspaceSelector<T>): T {
  return useSuspenseQuery({ ...workspaceQueries.state, select }).data;
}

export function useUpdateWorkspaceSetting() {
  const queryClient = useQueryClient();

  return <Key extends keyof Settings>(key: Key, value: Settings[Key]): void =>
    updateWorkspaceSetting(queryClient, key, value);
}
