// Server functions for hydrating and mutating shared workspace state.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  applyWorkspaceAction,
  changeSettings,
  deleteInboxEntry as deleteInboxEntryState,
  getEnvironment,
  getWorkspaceState as readWorkspaceState,
  loadCustomEditors,
} from "./state/workspace";
import { AutomationDatabase } from "./automations/database";
import { AppDatabase } from "./apps/state/database";
import { appDefinitionRegistry } from "./apps/state/definitions";
import { getStateDatabase } from "./state/database";
import { deleteSessionIfExists } from "./state/session/registry";
import { retainSessionSnapshots } from "./state/session/snapshots";
import { hasInboxEntry } from "./state/workspace/inbox";
import { workspaceActionSchema } from "@/lib/workspace/state/actions";
import { settingsUpdateSchema } from "@/lib/workspace/config/settings";
import type { WorkspaceState } from "@/lib/workspace/state/reducer";
import type { Settings } from "@/types";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceState> => {
    const [customEditors, appDefinitions, database] = await Promise.all([
      loadCustomEditors(),
      appDefinitionRegistry.list(),
      getStateDatabase({ createIfMissing: false }),
    ]);
    const stores = database
      ? { automations: new AutomationDatabase(database), apps: new AppDatabase(database) }
      : null;
    const [automations, apps, appShares] = stores
      ? await Promise.all([stores.automations.list(), stores.apps.list(), stores.apps.listShares()])
      : [[], [], []];
    return readWorkspaceState({
      automations,
      customEditors,
      appDefinitions,
      apps,
      appShares,
      environment: getEnvironment(),
    });
  },
);

export const dispatchWorkspaceAction = createServerFn({ method: "POST" })
  .validator(zodValidator(workspaceActionSchema))
  .handler(async ({ data }): Promise<void> => {
    applyWorkspaceAction(data);
  });

export const updateSettings = createServerFn({ method: "POST" })
  .validator(zodValidator(settingsUpdateSchema))
  .handler(async ({ data }): Promise<Settings> => {
    const settings = await changeSettings(data);
    // Pinning is durable interest in a session, so its snapshot stays warm.
    // Warming runs past this response rather than delaying the change.
    void retainSessionSnapshots(settings.pinnedSessionIds);
    return settings;
  });

export const deleteInboxEntry = createServerFn({ method: "POST" })
  .validator(zodValidator(z.object({ entryId: z.string() })))
  .handler(async ({ data }): Promise<boolean> => {
    if (!(await hasInboxEntry(data.entryId))) return false;
    await deleteSessionIfExists(data.entryId);
    return deleteInboxEntryState(data.entryId);
  });
