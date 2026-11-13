// Validated remote ingress for shared workspace state and the server resource.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { disableIdleTimeout } from "@/shared/server/http";
import { settingsUpdateSchema } from "../model/config/settings";
import { draftKeySchema, savedDraftSchema } from "../model/state/drafts";
import * as workspace from "./state";
import * as connections from "./connections";
import * as installation from "./installation";
import * as links from "./links";

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

export const updateServer = createServerFn({ method: "POST" }).handler(() => {
  disableIdleTimeout(getRequest());
  return installation.updateServer();
});

export const restartServer = createServerFn({ method: "POST" }).handler(() => {
  disableIdleTimeout(getRequest());
  return installation.restartServer();
});

export const getLinkedServer = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(({ data }) => links.getLinkedServer(data));

export const linkServer = createServerFn({ method: "POST" })
  .validator(links.linkInputSchema)
  .handler(({ data }) => links.linkServer(data.address, links.requestLink(getRequest())));

export const unlinkServer = createServerFn({ method: "POST" })
  .validator(links.linkInputSchema)
  .handler(({ data }) => links.unlinkServer(data.address, links.requestLink(getRequest())));
