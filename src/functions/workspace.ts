// Server functions for hydrating and mutating shared workspace state.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  applyWorkspaceAction,
  deleteInboxEntry as deleteInboxEntryState,
  getEnvironment,
  getWorkspaceState as readWorkspaceState,
  loadCustomArtifacts,
  sweepExpiredDrafts,
} from "./state/workspace";
import { deleteSessionIfExists } from "./state/session/registry";
import { hasInboxEntry } from "./state/workspace/inbox";
import { workspaceActionSchema } from "@/lib/workspace/actions";
import type { WorkspaceState } from "@/lib/workspace/state";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceState> => {
    sweepExpiredDrafts();
    const customArtifacts = await loadCustomArtifacts();
    return await readWorkspaceState({
      customArtifacts,
      environment: getEnvironment(),
    });
  },
);

export const dispatchWorkspaceAction = createServerFn({ method: "POST" })
  .validator(zodValidator(workspaceActionSchema))
  .handler(async ({ data }): Promise<void> => {
    applyWorkspaceAction(data);
  });

export const deleteInboxEntry = createServerFn({ method: "POST" })
  .validator(zodValidator(z.object({ entryId: z.string() })))
  .handler(async ({ data }): Promise<boolean> => {
    if (!(await hasInboxEntry(data.entryId))) return false;
    await deleteSessionIfExists(data.entryId);
    return deleteInboxEntryState(data.entryId);
  });
