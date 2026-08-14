import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { AppDefinition, AppInstance, AppShare } from "@apps/model";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import { appMutations } from "./mutations";

const definition = {
  id: "kanban",
  title: "Kanban",
  color: "#f59e0b",
  state: { schema: { type: "object" }, default: {} },
  accepts: ["text/plain"],
  revision: "definition-a",
} satisfies AppDefinition;

const installedApp = {
  id: "app-installed",
  definitionId: definition.id,
  title: "Installed board",
  color: definition.color,
  state: {},
  revision: 0,
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
} satisfies AppInstance;

const createdApp = {
  ...installedApp,
  id: "app-created",
  title: "Created board",
} satisfies AppInstance;

describe("app mutation options", () => {
  test("projects successful app lifecycles into the workspace cache", async () => {
    const queryClient = createQueryClient();

    await new MutationObserver(queryClient, {
      ...appMutations.install(),
      mutationFn: async () => ({ definition, app: installedApp }),
    }).mutate("https://gist.github.com/example/kanban");

    expect(readWorkspace(queryClient).appDefinitions).toEqual([definition]);
    expect(readWorkspace(queryClient).apps).toEqual([installedApp]);

    await new MutationObserver(queryClient, {
      ...appMutations.create(definition.id),
      mutationFn: async () => createdApp,
    }).mutate(createdApp.title);

    expect(readWorkspace(queryClient).apps).toEqual([createdApp, installedApp]);

    const updatedApp = {
      ...createdApp,
      title: "Renamed board",
      revision: 1,
      updatedAt: "2026-07-28T12:01:00.000Z",
    } satisfies AppInstance;
    await new MutationObserver(queryClient, {
      ...appMutations.update(createdApp),
      mutationFn: async () => ({ status: "updated" as const, app: updatedApp }),
    }).mutate({ title: updatedApp.title });

    expect(readWorkspace(queryClient).apps).toEqual([installedApp, updatedApp]);

    const share = {
      id: "share-a",
      sourceAppId: installedApp.id,
      targetAppId: updatedApp.id,
      mimeType: "text/plain",
      content: "Ship it",
      createdAt: "2026-07-28T12:02:00.000Z",
    } satisfies AppShare;
    await new MutationObserver(queryClient, {
      ...appMutations.share({
        sourceAppId: installedApp.id,
        mimeType: share.mimeType,
        content: share.content,
      }),
      mutationFn: async () => share,
    }).mutate(updatedApp.id);

    expect(readWorkspace(queryClient).appShares).toEqual([share]);

    for (const appId of [installedApp.id, updatedApp.id]) {
      await new MutationObserver(queryClient, {
        ...appMutations.delete(appId),
        mutationFn: async () => undefined,
      }).mutate();
    }
    await new MutationObserver(queryClient, {
      ...appMutations.uninstall(definition.id),
      mutationFn: async () => undefined,
    }).mutate();

    expect(readWorkspace(queryClient)).toEqual(createEmptyWorkspaceState());
  });

  test("treats update conflicts as authoritative results", async () => {
    const queryClient = createQueryClient();
    const latestApp = {
      ...createdApp,
      title: "Changed elsewhere",
      revision: 2,
      updatedAt: "2026-07-28T12:02:00.000Z",
    } satisfies AppInstance;
    const updateMutation = new MutationObserver(queryClient, {
      ...appMutations.update(createdApp),
      mutationFn: async () => ({ status: "conflict" as const, app: latestApp }),
    });

    await expect(updateMutation.mutate({ title: "My rename" })).resolves.toEqual({
      status: "conflict",
      app: latestApp,
    });
    expect(readWorkspace(queryClient).apps).toEqual([latestApp]);
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readWorkspace(queryClient: QueryClient): WorkspaceState {
  const workspace = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!workspace) throw new Error("Workspace state was not cached");
  return workspace;
}
