// Client-safe RPC declarations for app definitions and saved instances.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  artifactAppBundleInputSchema,
  appDefinitionBundleInputSchema,
  appDefinitionInputSchema,
  appIdInputSchema,
  consumeAppShareInputSchema,
  createAppInputSchema,
  installAppInputSchema,
  shareWithAppInputSchema,
  updateAppInputSchema,
} from "@apps/model";
import * as apps from "./index";

export const createApp = createServerFn({ method: "POST" })
  .validator(zodValidator(createAppInputSchema))
  .handler(({ data }) => apps.createApp(data));

export const updateApp = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAppInputSchema))
  .handler(({ data }) => apps.updateApp(data));

export const deleteApp = createServerFn({ method: "POST" })
  .validator(zodValidator(appIdInputSchema))
  .handler(({ data }) => apps.deleteApp(data.appId));

export const shareWithApp = createServerFn({ method: "POST" })
  .validator(zodValidator(shareWithAppInputSchema))
  .handler(({ data }) => apps.shareWithApp(data));

export const consumeAppShare = createServerFn({ method: "POST" })
  .validator(zodValidator(consumeAppShareInputSchema))
  .handler(({ data }) => apps.consumeAppShare(data));

export const installApp = createServerFn({ method: "POST" })
  .validator(zodValidator(installAppInputSchema))
  .handler(({ data }) => apps.installApp(data));

export const uninstallApp = createServerFn({ method: "POST" })
  .validator(zodValidator(appDefinitionInputSchema))
  .handler(({ data }) => apps.uninstallApp(data));

export const getAppDefinitionBundle = createServerFn({ method: "GET" })
  .validator(zodValidator(appDefinitionBundleInputSchema))
  .handler(({ data }) => apps.getAppDefinitionBundle(data.definitionId, data.revision));

export const getArtifactAppBundle = createServerFn({ method: "GET" })
  .validator(zodValidator(artifactAppBundleInputSchema))
  .handler(({ data }) => apps.getArtifactAppBundle(data.file));
