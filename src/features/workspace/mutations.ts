import type { QueryClient } from "@tanstack/react-query";
import {
  dispatchWorkspaceAction as requestWorkspaceAction,
  updateSettings as requestSettingsUpdate,
} from "./server/functions";
import { areSettingsEqual, type Settings } from "./model/config/settings";
import type { WorkspaceAction } from "./model/state/actions";
import type { WorkspaceState } from "./model/state/reducer";
import { workspaceJournal, workspaceQueries } from "./queries";
import { applyWorkspaceEvent } from "./sync";

export function dispatchWorkspaceAction(queryClient: QueryClient, action: WorkspaceAction): void {
  applyWorkspaceEvent(queryClient, action);

  // The server echo is idempotent. A rejected command repairs the optimistic
  // transition from a fresh authoritative snapshot.
  void requestWorkspaceAction({ data: action }).catch(() => workspaceJournal.repair(queryClient));
}

export function updateWorkspaceSetting<Key extends keyof Settings>(
  queryClient: QueryClient,
  key: Key,
  value: Settings[Key],
): void {
  const workspace = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!workspace) return;

  const settings = { ...workspace.settings, [key]: value };
  if (areSettingsEqual(workspace.settings, settings)) return;
  // Catalog membership depends on persisted providers and pins. Publish those
  // preferences after saving so their refetch sees the accepted selection.
  const changesCatalog = key === "disabledProviders" || key === "pinnedSessionIds";
  if (!changesCatalog) applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

  void requestSettingsUpdate({ data: { [key]: value } })
    .then((settings) => {
      if (changesCatalog) applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });
    })
    .catch(() => workspaceJournal.repair(queryClient));
}
