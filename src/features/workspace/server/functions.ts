// Validated remote ingress for shared workspace state.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { settingsUpdateSchema } from "../model/config/settings";
import { workspaceActionSchema } from "../model/state/actions";
import * as workspace from "./state";
import * as connections from "./connections";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(() =>
  workspace.getWorkspaceState(),
);

export const dispatchWorkspaceAction = createServerFn({ method: "POST" })
  .validator(zodValidator(workspaceActionSchema))
  .handler(({ data }) => workspace.applyWorkspaceAction(data));

export const updateSettings = createServerFn({ method: "POST" })
  .validator(zodValidator(settingsUpdateSchema))
  .handler(({ data }) => workspace.updateSettings(data));

/** End something a tab attached to its connection, such as a file watch, before the tab closes. */
export const releaseLease = createServerFn({ method: "POST" })
  .validator(zodValidator(z.object({ connection: z.string(), lease: z.string() })))
  .handler(({ data }) => connections.releaseLease(data.connection, data.lease));
