// Client-safe RPC declarations for app definitions and saved instances.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  appDefinitionBundleInputSchema,
  appDefinitionInputSchema,
  appIdInputSchema,
  consumeAppShareInputSchema,
  createAppInputSchema,
  installAppInputSchema,
  shareWithAppInputSchema,
  updateAppInputSchema,
  type AppUpdateResult,
} from "@/lib/apps/schema";
import type { AppInstance, AppShare } from "@/types";
import * as apps from "./apps/index";

export const createApp = createServerFn({ method: "POST" })
  .validator(zodValidator(createAppInputSchema))
  .handler(async ({ data }): Promise<AppInstance> => {
    return apps.createApp(data);
  });

export const updateApp = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAppInputSchema))
  .handler(async ({ data }): Promise<AppUpdateResult> => {
    return apps.updateApp(data);
  });

export const deleteApp = createServerFn({ method: "POST" })
  .validator(zodValidator(appIdInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await apps.deleteApp(data.appId);
  });

export const shareWithApp = createServerFn({ method: "POST" })
  .validator(zodValidator(shareWithAppInputSchema))
  .handler(async ({ data }): Promise<AppShare> => {
    return apps.shareWithApp(data);
  });

export const consumeAppShare = createServerFn({ method: "POST" })
  .validator(zodValidator(consumeAppShareInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    return apps.consumeAppShare(data);
  });

export const installApp = createServerFn({ method: "POST" })
  .validator(zodValidator(installAppInputSchema))
  .handler(async ({ data }) => {
    return apps.installApp(data);
  });

export const uninstallApp = createServerFn({ method: "POST" })
  .validator(zodValidator(appDefinitionInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await apps.uninstallApp(data);
  });

export const getAppDefinitionBundle = createServerFn({ method: "GET" })
  .validator(zodValidator(appDefinitionBundleInputSchema))
  .handler(async ({ data }) => {
    return apps.getAppDefinitionBundle(data.definitionId, data.revision);
  });
