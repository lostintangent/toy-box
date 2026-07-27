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
import { getAppDatabase } from "./state/database";
import { deleteSessionIfExists } from "./state/session/registry";
import { retainSessionSnapshots } from "./state/session/snapshots";
import { hasInboxEntry } from "./state/workspace/inbox";
import { workspaceActionSchema } from "@/lib/workspace/state/actions";
import { settingsUpdateSchema } from "@/lib/workspace/config/settings";
import type { WorkspaceState } from "@/lib/workspace/state/reducer";
import type { Settings } from "@/types";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceState> => {
    const [customEditors, database] = await Promise.all([
      loadCustomEditors(),
      getAppDatabase({ createIfMissing: false }),
    ]);
    const automations = database ? await new AutomationDatabase(database).list() : [];
    return readWorkspaceState({
      automations,
      customEditors,
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
