// Client-safe RPC declarations for app definitions and saved instances.

import { createServerFn } from "@tanstack/react-start";
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
import { appDefinitionRegistry } from "./definitions";

export const listApps = createServerFn({ method: "GET" }).handler(() => apps.listApps());

export const createApp = createServerFn({ method: "POST" })
  .validator(createAppInputSchema)
  .handler(({ data }) => apps.createApp(data));

export const updateApp = createServerFn({ method: "POST" })
  .validator(updateAppInputSchema)
  .handler(({ data }) => apps.updateApp(data));

export const deleteApp = createServerFn({ method: "POST" })
  .validator(appIdInputSchema)
  .handler(({ data }) => apps.deleteApp(data.appId));

export const shareWithApp = createServerFn({ method: "POST" })
  .validator(shareWithAppInputSchema)
  .handler(({ data }) => apps.shareWithApp(data));

export const consumeAppShare = createServerFn({ method: "POST" })
  .validator(consumeAppShareInputSchema)
  .handler(({ data }) => apps.consumeAppShare(data));

export const installApp = createServerFn({ method: "POST" })
  .validator(installAppInputSchema)
  .handler(({ data }) => apps.installApp(data));

export const uninstallApp = createServerFn({ method: "POST" })
  .validator(appDefinitionInputSchema)
  .handler(({ data }) => apps.uninstallApp(data));

export const getAppDefinitionBundle = createServerFn({ method: "GET" })
  .validator(appDefinitionBundleInputSchema)
  .handler(({ data }) => appDefinitionRegistry.getBundle(data.definitionId, data.revision));

export const getArtifactAppBundle = createServerFn({ method: "GET" })
  .validator(artifactAppBundleInputSchema)
  .handler(({ data }) => apps.getArtifactAppBundle(data.file));
