import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  appDefinitionInputSchema,
  appIdInputSchema,
  appWorkerUpdateInputSchema,
  createAppInputSchema,
  installAppInputSchema,
  updateAppInputSchema,
} from "@apps/model";

const listAppDefinitionsTool = defineTool("list_app_definitions", {
  description: "Lists installed Toy Box app definitions, including state schemas and defaults.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  handler: async () => {
    const apps = await import("@apps/server");
    return JSON.stringify(await apps.listAppDefinitions());
  },
});

const listAppsTool = defineTool("list_apps", {
  description:
    "Lists saved Toy Box app instances without their state. Call get_app to inspect an instance before updating it.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  handler: async () => {
    const appLifecycle = await import("@apps/server");
    const apps = await appLifecycle.listApps();
    return JSON.stringify(
      apps.map(({ id, definitionId, title, color, revision, createdAt, updatedAt }) => ({
        id,
        definitionId,
        title,
        color,
        revision,
        createdAt,
        updatedAt,
      })),
    );
  },
});

const getAppTool = defineTool("get_app", {
  description:
    "Gets an app's complete state, revision, and JSON Schema. Pass its revision as update_app.expectedRevision.",
  parameters: appIdInputSchema,
  skipPermission: true,
  handler: async ({ appId }) => {
    return JSON.stringify(await getApp(appId));
  },
});

const registerAppTool = defineTool("register_app", {
  description:
    "Validates the manifest state contract, typechecks and compiles TSX, then activates ~/.toy-box/apps/<id>/.",
  parameters: appDefinitionInputSchema,
  skipPermission: true,
  handler: async (input) => {
    try {
      const apps = await import("@apps/server");
      const definition = await apps.registerApp(input);
      return JSON.stringify({
        registered: definition.id,
        revision: definition.revision,
        note: "Definition active. Create a saved instance with create_app only if needed.",
      });
    } catch (error) {
      return JSON.stringify({
        registered: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

const createAppTool = defineTool("create_app", {
  description: "Creates a saved instance of an installed Toy Box app definition.",
  parameters: createAppInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const apps = await import("@apps/server");
    const app = await apps.createApp(input);
    return JSON.stringify({
      appId: app.id,
      definitionId: app.definitionId,
      title: app.title,
      saved: true,
    });
  },
});

const installAppTool = defineTool("install_app", {
  description:
    "Installs an app definition from a public GitHub Gist and creates its first saved instance.",
  parameters: installAppInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const apps = await import("@apps/server");
    const { definition, app } = await apps.installApp(input);
    return JSON.stringify({
      installed: definition.id,
      revision: definition.revision,
      appId: app.id,
      title: app.title,
      saved: true,
    });
  },
});

const uninstallAppTool = defineTool("uninstall_app", {
  description: "Deletes an installed app definition that has no saved instances.",
  parameters: appDefinitionInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const apps = await import("@apps/server");
    await apps.uninstallApp(input);
    return JSON.stringify({ uninstalled: input.id });
  },
});

const updateAppTool = defineTool("update_app", {
  description:
    "Replaces app state at expectedRevision after schema validation. On conflict, merge current state and retry.",
  parameters: updateAppInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const apps = await import("@apps/server");
    const result = await apps.updateApp(input);
    return JSON.stringify(result);
  },
});

const deleteAppTool = defineTool("delete_app", {
  description: "Deletes a saved app instance and all of its app-owned worker sessions.",
  parameters: appIdInputSchema,
  skipPermission: true,
  handler: async ({ appId }) => {
    const apps = await import("@apps/server");
    await apps.deleteApp(appId);
    return JSON.stringify({ deleted: appId });
  },
});

export function createAppStateTools(appId?: string) {
  if (!appId) return [listAppsTool, getAppTool, updateAppTool];

  return [
    listAppsTool,
    defineTool("get_app", {
      description:
        "Gets the owning app's state, revision, and JSON Schema. Pass its revision as update_app.expectedRevision.",
      parameters: z.object({}).strict(),
      skipPermission: true,
      handler: async () => JSON.stringify(await getApp(appId)),
    }),
    defineTool("update_app", {
      description:
        "Replaces owning app state at expectedRevision after schema validation. On conflict, merge current state and retry.",
      parameters: appWorkerUpdateInputSchema,
      skipPermission: true,
      handler: async (input) => {
        const apps = await import("@apps/server");
        return JSON.stringify(await apps.updateApp({ appId, ...input }));
      },
    }),
  ];
}

export const appLifecycleTools = [
  listAppDefinitionsTool,
  registerAppTool,
  installAppTool,
  uninstallAppTool,
  createAppTool,
  deleteAppTool,
];

async function getApp(appId: string) {
  const apps = await import("@apps/server");
  const [app, definitions] = await Promise.all([apps.getApp(appId), apps.listAppDefinitions()]);
  const definition = definitions.find(({ id }) => id === app.definitionId);
  if (!definition) throw new Error(`App definition "${app.definitionId}" was not found.`);
  return { ...app, schema: definition.state.schema };
}
