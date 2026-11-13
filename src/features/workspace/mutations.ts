import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  linkServer,
  restartServer,
  unlinkServer,
  updateDraft as requestDraftUpdate,
  updateServer,
  updateSettings as requestSettingsUpdate,
} from "./server/functions";
import { areSettingsEqual, CATALOG_SETTINGS, type Settings } from "./model/config/settings";
import type { DraftKey } from "./model/state/drafts";
import { workspaceQueries } from "./queries";
import { applyWorkspaceEvent } from "./sync";

// The default gcTime keeps a finished run's error or "Restarting…" for a reopened Settings.
export const workspaceMutations = {
  updateServer: () =>
    mutationOptions({
      mutationKey: ["workspace", "server", "update"],
      mutationFn: () => updateServer(),
    }),
  restartServer: () =>
    mutationOptions({
      mutationKey: ["workspace", "server", "restart"],
      mutationFn: () => restartServer(),
    }),
  linkServer: () =>
    mutationOptions({
      mutationFn: (address: string) => linkServer({ data: { address } }),
    }),
  unlinkServer: () =>
    mutationOptions({
      mutationFn: (address: string) => unlinkServer({ data: { address } }),
    }),
};

export function updateDraft(
  queryClient: QueryClient,
  update: { key: DraftKey; text: string; origin: string },
): void {
  const { key, text, origin } = update;
  const draft = { text, origin, updatedAt: Date.now() };
  applyWorkspaceEvent(queryClient, { type: "draft.changed", key, draft });

  // The server's stamped echo replaces this draft, and a rejection repairs from a fresh snapshot.
  void requestDraftUpdate({ data: update }).catch(() => workspaceQueries.state.repair(queryClient));
}

export function updateWorkspaceSetting<Key extends keyof Settings>(
  queryClient: QueryClient,
  key: Key,
  value: Settings[Key],
): void {
  const workspace = queryClient.getQueryData(workspaceQueries.state.queryKey);
  if (!workspace) return;

  const settings = { ...workspace.settings, [key]: value };
  if (areSettingsEqual(workspace.settings, settings)) return;
  // Catalog membership depends on persisted providers and pins. Publish those
  // preferences after saving so their refetch sees the accepted selection.
  const changesCatalog = CATALOG_SETTINGS.includes(key);
  if (!changesCatalog) applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

  void requestSettingsUpdate({ data: { [key]: value } })
    .then((settings) => {
      if (changesCatalog) applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });
    })
    .catch(() => workspaceQueries.state.repair(queryClient));
}
