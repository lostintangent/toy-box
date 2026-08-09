// Validated remote ingress for shared workspace state.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { settingsUpdateSchema } from "../model/config/settings";
import { workspaceActionSchema } from "../model/state/actions";
import * as workspace from ".";

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(() =>
  workspace.getWorkspaceState(),
);

export const dispatchWorkspaceAction = createServerFn({ method: "POST" })
  .validator(zodValidator(workspaceActionSchema))
  .handler(({ data }) => workspace.applyWorkspaceAction(data));

export const updateSettings = createServerFn({ method: "POST" })
  .validator(zodValidator(settingsUpdateSchema))
  .handler(({ data }) => workspace.updateSettings(data));
