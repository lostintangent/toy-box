// Server-side Workspace operations shared by validated ingress.

import { listAutomations } from "@automations/server";
import { AppDatabase } from "@apps/server/database";
import { appDefinitionRegistry } from "@apps/server/definitions";
import { loadCustomEditors } from "@files/server/editors";
import { listInboxEntries } from "@inbox/server";
import { retainSessionSnapshots } from "@sessions/server/state/snapshots";
import { getStateDatabase } from "@/server/database";
import type { Settings } from "../model/config/settings";
import type { WorkspaceState } from "../model/state/reducer";
import {
  applyWorkspaceAction,
  changeSettings,
  getEnvironment,
  getWorkspaceState as readWorkspaceState,
} from "./state";

export { applyWorkspaceAction };

/** Assemble the current projection from each feature's authoritative facts. */
export async function getWorkspaceState(): Promise<WorkspaceState> {
  const [automations, inboxEntries, customEditors, appDefinitions, database] = await Promise.all([
    listAutomations(),
    listInboxEntries(),
    loadCustomEditors(),
    appDefinitionRegistry.list(),
    getStateDatabase({ createIfMissing: false }),
  ]);
  const appStore = database ? new AppDatabase(database) : null;
  const [apps, appShares] = appStore
    ? await Promise.all([appStore.list(), appStore.listShares()])
    : [[], []];

  return readWorkspaceState({
    automations,
    inboxEntries,
    customEditors,
    appDefinitions,
    apps,
    appShares,
    environment: getEnvironment(),
  });
}

export async function updateSettings(update: Partial<Settings>): Promise<Settings> {
  const settings = await changeSettings(update);
  // Pinning is durable interest in a session, so its snapshot stays warm.
  // Warming runs past this operation rather than delaying the change.
  void retainSessionSnapshots(settings.pinnedSessionIds);
  return settings;
}
