import { mutationOptions } from "@tanstack/react-query";
import type { AppInstance, AppUpdate } from "./model";
import {
  createApp,
  deleteApp,
  installApp,
  shareWithApp,
  uninstallApp,
  updateApp,
} from "./server/functions";
import { smallJsonSchema } from "@/shared/smallJson";
import { applyWorkspaceEvent } from "@workspace/queries";

type ShareWithApp = {
  appId: string;
  mimeType: string;
  content: unknown;
};

export const appMutations = {
  create: (definitionId: string) =>
    mutationOptions({
      mutationFn: (title: string) => createApp({ data: { definitionId, title } }),
      onSuccess: (app, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.upserted", app });
      },
    }),

  install: () =>
    mutationOptions({
      mutationFn: (url: string) => installApp({ data: { url } }),
      onSuccess: ({ definition, app }, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.registered", definition });
        applyWorkspaceEvent(client, { type: "app.upserted", app });
      },
    }),

  update: (app: AppInstance) =>
    mutationOptions({
      mutationFn: (update: Omit<AppUpdate, "expectedRevision">) => updateAppInstance(app, update),
      onSuccess: (result, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.upserted", app: result.app });
      },
    }),

  rename: (app: AppInstance) =>
    mutationOptions({
      mutationFn: async (title: string) => {
        const result = await updateAppInstance(app, { title });
        if (result.status === "conflict") {
          throw new Error("The app changed repeatedly while being renamed. Try again.");
        }
        return result.app;
      },
      onSuccess: (renamedApp, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.upserted", app: renamedApp });
      },
    }),

  uninstall: (definitionId: string) =>
    mutationOptions({
      mutationFn: () => uninstallApp({ data: { id: definitionId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.unregistered", definitionId });
      },
    }),

  delete: (appId: string) =>
    mutationOptions({
      mutationFn: () => deleteApp({ data: { appId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.deleted", appId });
      },
    }),

  share: ({ appId, mimeType, content }: ShareWithApp) =>
    mutationOptions({
      mutationFn: (targetAppId: string) =>
        shareWithApp({
          data: {
            appId,
            targetAppId,
            mimeType,
            content: smallJsonSchema.parse(content),
          },
        }),
      onSuccess: (share, _variables, _onMutateResult, { client }) => {
        applyWorkspaceEvent(client, { type: "app.share.created", share });
      },
    }),
};

async function updateAppInstance(app: AppInstance, update: Omit<AppUpdate, "expectedRevision">) {
  let result = await updateApp({
    data: { appId: app.id, expectedRevision: app.revision, ...update },
  });
  if (result.status === "conflict") {
    result = await updateApp({
      data: { appId: app.id, expectedRevision: result.app.revision, ...update },
    });
  }
  return result;
}
