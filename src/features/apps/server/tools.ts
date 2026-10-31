import { defineTool, type Tool } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  artifactAppPathSchema,
  appDefinitionInputSchema,
  appIdInputSchema,
  appWorkerUpdateInputSchema,
  createAppInputSchema,
  installAppInputSchema,
  updateAppInputSchema,
} from "@apps/model";
import { createWorkspaceAppUrl } from "@apps/model/paths";
import { sessionFile } from "@files/model";
import { createWorkspaceFileUrl } from "@files/model/paths";
import { getStateDatabase } from "@/server/database";
import { AppDatabase } from "./database";
import { appDefinitionRegistry } from "./definitions";

const listAppDefinitionsTool = defineTool("list_app_definitions", {
  description: "Lists installed Toy Box app definitions, including state schemas and defaults.",
  parameters: z.object({}).strict(),
  handler: () => appDefinitionRegistry.list(),
});

const listAppsTool = defineTool("list_apps", {
  description:
    "Lists saved Toy Box app instances without their state. Call get_app to inspect an instance before updating it.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const database = await getStateDatabase({ createIfMissing: false });
    const apps = database ? await new AppDatabase(database).list() : [];
    return apps.map(({ id, definitionId, title, color, revision, createdAt, updatedAt }) => ({
      id,
      definitionId,
      title,
      color,
      revision,
      createdAt,
      updatedAt,
    }));
  },
});

const getAppTool = defineTool("get_app", {
  description:
    "Gets an app's complete state, revision, JSON Schema, and direct preview URL. Pass its revision as update_app.expectedRevision.",
  parameters: appIdInputSchema,
  handler: ({ appId }) => getApp(appId),
});

const registerAppTool = defineTool("register_app", {
  description:
    "Validates the manifest state contract, typechecks and compiles TSX, then activates ~/.toy-box/apps/<id>/.",
  parameters: appDefinitionInputSchema,
  handler: async (input) => {
    try {
      const apps = await import("@apps/server");
      const definition = await apps.registerApp(input);
      return {
        registered: definition.id,
        revision: definition.revision,
        note: "Definition active. Create a saved instance with create_app only if needed.",
      };
    } catch (error) {
      return {
        registered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

const validateArtifactAppTool = defineTool("validate_artifact_app", {
  description:
    "Typechecks and compiles a .toy app in the current session without registering it, then returns its direct preview URL.",
  parameters: z
    .object({
      path: artifactAppPathSchema.describe(
        "Path relative to the current session's artifacts folder.",
      ),
    })
    .strict(),
  handler: async ({ path }, sessionId) => {
    try {
      const apps = await import("@apps/server");
      const file = sessionFile(sessionId, path);
      await apps.getArtifactAppBundle(file);
      return { valid: true, path, previewUrl: createWorkspaceFileUrl(file) };
    } catch (error) {
      return {
        valid: false,
        path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

const createAppTool = defineTool("create_app", {
  description:
    "Creates a saved instance of an installed Toy Box app definition and returns its direct preview URL.",
  parameters: createAppInputSchema,
  handler: async (input) => {
    const apps = await import("@apps/server");
    const app = await apps.createApp(input);
    return {
      appId: app.id,
      definitionId: app.definitionId,
      title: app.title,
      saved: true,
      previewUrl: createWorkspaceAppUrl(app.id),
    };
  },
});

const installAppTool = defineTool("install_app", {
  description:
    "Installs an app definition from a public GitHub Gist and creates its first saved instance with a direct preview URL.",
  parameters: installAppInputSchema,
  handler: async (input) => {
    const apps = await import("@apps/server");
    const { definition, app } = await apps.installApp(input);
    return {
      installed: definition.id,
      revision: definition.revision,
      appId: app.id,
      title: app.title,
      saved: true,
      previewUrl: createWorkspaceAppUrl(app.id),
    };
  },
});

const uninstallAppTool = defineTool("uninstall_app", {
  description: "Deletes an installed app definition that has no saved instances.",
  parameters: appDefinitionInputSchema,
  handler: async (input) => {
    const apps = await import("@apps/server");
    await apps.uninstallApp(input);
    return { uninstalled: input.id };
  },
});

const updateAppTool = defineTool("update_app", {
  description:
    "Replaces app state at expectedRevision after schema validation. On conflict, merge current state and retry.",
  parameters: updateAppInputSchema,
  handler: async (input) => {
    const apps = await import("@apps/server");
    return apps.updateApp(input);
  },
});

const deleteAppTool = defineTool("delete_app", {
  description: "Deletes a saved app instance and all of its app-owned worker sessions.",
  parameters: appIdInputSchema,
  handler: async ({ appId }) => {
    const apps = await import("@apps/server");
    await apps.deleteApp(appId);
    return { deleted: appId };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAppStateTools(appId?: string): Tool<any>[] {
  if (!appId) return [listAppsTool, getAppTool, updateAppTool];

  return [
    listAppsTool,
    defineTool("get_app", {
      description:
        "Gets the owning app's state, revision, JSON Schema, and direct preview URL. Pass its revision as update_app.expectedRevision.",
      parameters: z.object({}).strict(),
      handler: () => getApp(appId),
    }),
    defineTool("update_app", {
      description:
        "Replaces owning app state at expectedRevision after schema validation. On conflict, merge current state and retry.",
      parameters: appWorkerUpdateInputSchema,
      handler: async (input) => {
        const apps = await import("@apps/server");
        return apps.updateApp({ appId, ...input });
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

export const artifactAppTools = [validateArtifactAppTool];

async function getApp(appId: string) {
  const apps = await import("@apps/server");
  const app = await apps.getApp(appId);
  const definition = await appDefinitionRegistry.get(app.definitionId);
  if (!definition) throw new Error(`App definition "${app.definitionId}" was not found.`);
  return { ...app, schema: definition.state.schema, previewUrl: createWorkspaceAppUrl(app.id) };
}
