// Validated remote ingress for shared workspace state.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { settingsUpdateSchema } from "../model/config/settings";
import { draftKeySchema, savedDraftSchema } from "../model/state/drafts";
import * as workspace from "./state";
import * as connections from "./connections";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(() =>
  workspace.getWorkspaceState(),
);

export const updateDraft = createServerFn({ method: "POST" })
  .validator(savedDraftSchema.pick({ text: true, origin: true }).extend({ key: draftKeySchema }))
  .handler(({ data }) => workspace.updateDraft(data.key, data.text, data.origin));

export const updateSettings = createServerFn({ method: "POST" })
  .validator(settingsUpdateSchema)
  .handler(({ data }) => workspace.updateSettings(data));

/** End something a tab attached to its connection, such as a file watch, before the tab closes. */
export const releaseLease = createServerFn({ method: "POST" })
  .validator(z.object({ connection: z.string(), lease: z.string() }))
  .handler(({ data }) => connections.releaseLease(data.connection, data.lease));
