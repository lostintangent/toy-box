// Aggregate lifecycle for app definitions and saved instances.
//
// This is the owning orchestration boundary for transitions that cross the
// filesystem registry, SQLite, workspace events, and app-owned workers.

import type { z } from "zod";
import type { CompiledAppBundle } from "@apps/runtime";
import type { SessionFile } from "@files/model";
import { readFile } from "@files/server";
import { parseAppState } from "@apps/model/state";
import {
  type appDefinitionInputSchema,
  type consumeAppShareInputSchema,
  appDefinitionIdSchema,
  type shareWithAppInputSchema,
  type AppUpdateResult,
  type createAppInputSchema,
  type installAppInputSchema,
  type updateAppInputSchema,
  type AppDefinition,
  type AppInstance,
  type AppShare,
} from "@apps/model";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { deleteWorkersForApp } from "@workers/server";
import { getStateDatabase } from "@/server/database";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { downloadGistApp } from "./gist";
import { AppDatabase } from "./database";
import { compileArtifactApp } from "./compiler";
import { appDefinitionRegistry, parseAppDefinitionFiles } from "./definitions";

const definitionQueues = sharedMap<SerialTaskQueue>("app-definition-queues");

export async function listAppDefinitions(): Promise<AppDefinition[]> {
  return appDefinitionRegistry.list();
}

export async function getAppDefinitionBundle(
  definitionId: string,
  revision: string,
): Promise<CompiledAppBundle> {
  return appDefinitionRegistry.getBundle(definitionId, revision);
}

export async function getArtifactAppBundle(file: SessionFile) {
  const source = await readFile(file);
  return compileArtifactApp(file, source.content);
}

export async function listApps(): Promise<AppInstance[]> {
  return new AppDatabase(await getStateDatabase()).list();
}

export async function getApp(appId: string): Promise<AppInstance> {
  const app = await new AppDatabase(await getStateDatabase()).get(appId);
  if (!app) throw new Error(`App "${appId}" was not found.`);
  return app;
}

export async function shareWithApp(
  input: z.output<typeof shareWithAppInputSchema>,
): Promise<AppShare> {
  const apps = new AppDatabase(await getStateDatabase());
  const [source, target] = await Promise.all([
    input.sourceAppId === null ? null : apps.get(input.sourceAppId),
    apps.get(input.targetAppId),
  ]);
  if (input.sourceAppId !== null && !source) {
    throw new Error(`App "${input.sourceAppId}" was not found.`);
  }
  if (!target) throw new Error(`App "${input.targetAppId}" was not found.`);

  const definition = await appDefinitionRegistry.get(target.definitionId);
  if (!definition?.accepts.includes(input.mimeType)) {
    throw new Error(`App "${target.title}" does not accept ${input.mimeType} content.`);
  }

  const share = await apps.createShare({
    sourceAppId: input.sourceAppId,
    targetAppId: target.id,
    mimeType: input.mimeType,
    content: input.content,
  });
  broadcast({ type: "app.share.created", share });
  return share;
}

export async function consumeAppShare(
  input: z.output<typeof consumeAppShareInputSchema>,
): Promise<boolean> {
  const deleted = await new AppDatabase(await getStateDatabase()).deleteShare(
    input.appId,
    input.shareId,
  );
  if (deleted) broadcast({ type: "app.share.deleted", shareId: input.shareId });
  return deleted;
}

export async function createApp(
  input: z.output<typeof createAppInputSchema>,
): Promise<AppInstance> {
  return changeDefinition(input.definitionId, async () => {
    const source = await appDefinitionRegistry.get(input.definitionId);
    if (!source) throw new Error(`App definition "${input.definitionId}" was not found.`);

    const app = await new AppDatabase(await getStateDatabase()).create({
      definitionId: source.id,
      title: input.title ?? source.title,
      color: input.color ?? source.color,
      state: parseAppState(
        source.state.schema,
        input.state === undefined ? source.state.default : input.state,
      ),
    });
    broadcast({ type: "app.upserted", app });
    return app;
  });
}

export async function updateApp(
  input: z.output<typeof updateAppInputSchema>,
): Promise<AppUpdateResult> {
  const { appId, ...update } = input;
  const apps = new AppDatabase(await getStateDatabase());
  if (update.state !== undefined) {
    const app = await apps.get(appId);
    if (!app) throw new Error(`App "${appId}" was not found.`);
    const definition = await appDefinitionRegistry.get(app.definitionId);
    if (!definition) throw new Error(`App definition "${app.definitionId}" was not found.`);
    update.state = parseAppState(definition.state.schema, update.state);
  }
  const result = await apps.update(appId, update);
  if (!result) throw new Error(`App "${appId}" was not found.`);
  if (result.status === "updated") {
    broadcast({ type: "app.upserted", app: result.app });
  }
  return result;
}

export async function deleteApp(appId: string): Promise<void> {
  const deleted = await new AppDatabase(await getStateDatabase()).delete(appId);
  if (!deleted) throw new Error(`App "${appId}" was not found.`);

  broadcast({ type: "app.deleted", appId });
  await deleteWorkersForApp(appId);
}

export async function registerApp(
  input: z.output<typeof appDefinitionInputSchema>,
): Promise<AppDefinition> {
  return changeDefinition(input.id, async () => {
    const definition = await appDefinitionRegistry.register(input.id);
    broadcast({ type: "app.registered", definition });
    return definition;
  });
}

export async function installApp(input: z.output<typeof installAppInputSchema>) {
  const files = await downloadGistApp(input.url);
  const candidate = parseAppDefinitionFiles({ manifest: files.manifest, tsx: files.tsx });
  const slug = candidate.definition.title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  const id = input.id ?? appDefinitionIdSchema.parse(slug || `gist-${files.gistId.slice(0, 16)}`);
  return changeDefinition(id, async () => {
    const definition = await appDefinitionRegistry.install(id, candidate);
    let app: AppInstance;
    try {
      app = await new AppDatabase(await getStateDatabase()).create({
        definitionId: definition.id,
        title: definition.title,
        color: definition.color,
        state: definition.state.default,
      });
    } catch (error) {
      await appDefinitionRegistry.uninstall(id);
      throw error;
    }

    broadcast({ type: "app.registered", definition });
    broadcast({ type: "app.upserted", app });
    return { definition, app };
  });
}

export async function uninstallApp(
  input: z.output<typeof appDefinitionInputSchema>,
): Promise<void> {
  await changeDefinition(input.id, async () => {
    const apps = new AppDatabase(await getStateDatabase());
    if (await apps.hasInstancesForDefinition(input.id)) {
      throw new Error(
        `App definition "${input.id}" is still used by saved app instances. Delete them before uninstalling the definition.`,
      );
    }

    const uninstalled = await appDefinitionRegistry.uninstall(input.id);
    if (!uninstalled) throw new Error(`App definition "${input.id}" is not installed.`);
    broadcast({ type: "app.unregistered", definitionId: input.id });
  });
}

function changeDefinition<Result>(
  definitionId: string,
  change: () => Promise<Result>,
): Promise<Result> {
  let queue = definitionQueues.get(definitionId);
  if (!queue) {
    queue = new SerialTaskQueue();
    definitionQueues.set(definitionId, queue);
  }

  return queue.enqueue(change);
}
