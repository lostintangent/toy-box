import { describe, expect, test } from "bun:test";
import type { SessionsState } from "@sessions/model";
import type { ModelCatalogInfo } from "@sessions/useModels";
import { createEmptyWorkspaceState } from "@workspace/model/state/reducer";
import { createLinkedSessionPane } from "@workspace/model/panes";
import { projectAppWorkspace } from "./workspace";

describe("app workspace projection", () => {
  test("exposes sessions with governance kinds and hides inbox implementation sessions", () => {
    const workspace = {
      ...createEmptyWorkspaceState(),
      sessionStates: {
        standard: { status: "running" as const },
        "session-worker": { status: "unread" as const },
        automation: { status: "unread" as const },
        hyper: { status: "running" as const },
      },
      hyperSessionIds: ["hyper"],
      automations: [
        {
          id: "automation",
          title: "Automation",
          prompt: "Run the automation",
          model: { name: "gpt-5" },
          cron: "0 9 * * *",
          createdAt: "2026-07-28T00:00:00.000Z",
          updatedAt: "2026-07-28T00:00:00.000Z",
          nextRunAt: "2026-07-29T09:00:00.000Z",
        },
      ],
      inboxEntries: [],
      apps: [
        {
          id: "app-a",
          definitionId: "kanban",
          title: "Launch",
          color: "#f59e0b" as const,
          state: {},
          revision: 4,
          createdAt: "2026-07-28T00:00:00.000Z",
          updatedAt: "2026-07-28T01:00:00.000Z",
        },
      ],
      appDefinitions: [
        {
          id: "kanban",
          title: "Kanban",
          color: "#f59e0b" as const,
          state: { schema: { type: "object" as const }, default: {} },
          accepts: ["text/markdown"],
          revision: "definition-a",
        },
      ],
      appShares: [
        {
          id: "share-a",
          sourceAppId: "app-b",
          targetAppId: "app-a",
          mimeType: "text/markdown",
          content: "# Ship the release",
          createdAt: "2026-07-28T00:30:00.000Z",
        },
      ],
      workers: [
        {
          type: "app" as const,
          sessionId: "app-worker",
          ephemeral: true,
          appId: "app-a",
          name: "Generate expression",
          metadata: { requestId: "request-a" },
        },
        {
          type: "app" as const,
          sessionId: "other-app-worker",
          ephemeral: false,
          appId: "app-b",
        },
      ],
    };
    const sessionsState: SessionsState = {
      sessions: [
        {
          sessionId: "standard",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Standard work",
          isRemote: false,
          context: { workingDirectory: "/repo" },
        },
        {
          sessionId: "automation",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Managed work",
          isRemote: false,
        },
        {
          sessionId: "hyper",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Hyper work",
          isRemote: false,
        },
        {
          sessionId: "app-worker",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Hidden worker",
          isRemote: false,
        },
        {
          sessionId: "session-worker",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Implement feature",
          isRemote: false,
          context: { workingDirectory: "/repo" },
        },
        {
          sessionId: "nested-worker",
          startTime: new Date("2026-07-28T00:00:00.000Z"),
          modifiedTime: new Date("2026-07-28T01:00:00.000Z"),
          summary: "Review feature",
          isRemote: false,
          context: { workingDirectory: "/repo" },
        },
      ],
      worktrees: {
        "session-worker": {
          path: "/tmp/worktree",
          branch: "toy-box/session-worker",
          baseBranch: "main",
        },
      },
      workerSessionParents: {
        "app-worker": null,
        "session-worker": "standard",
        "nested-worker": "session-worker",
      },
    };

    const models: ModelCatalogInfo[] = [
      {
        id: "gpt-5",
        name: "GPT-5",
        capabilities: {
          supports: { vision: false, reasoningEffort: true },
          limits: {
            max_context_window_tokens: 1_000_000,
            max_prompt_tokens: 936_000,
          },
        },
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "high",
        supportedContextTiers: [
          { name: "default", tokenWindow: 264_000 },
          { name: "future_tier", tokenWindow: 1_000_000 },
        ],
        billing: {
          multiplier: 2,
          tokenPrices: {
            maxPromptTokens: 200_000,
            longContext: { maxPromptTokens: 936_000 },
          },
        },
      },
    ];
    const openPanes = [createLinkedSessionPane("standard")];
    const defaultModel = { name: "gpt-5", reasoningEffort: "low" };
    const source = {
      workspace,
      sessions: sessionsState,
      models,
      defaultModel,
      appId: "app-a",
      openPanes,
    };
    const projection = projectAppWorkspace(source);

    expect(projection).toEqual({
      sessions: [
        {
          id: "standard",
          title: "Standard work",
          status: "running",
          kind: "standard",
          directory: "/repo",
          isRemote: false,
          worktree: undefined,
          children: [
            {
              id: "session-worker",
              title: "Implement feature",
              status: "unread",
              kind: "standard",
              directory: "/repo",
              isRemote: false,
              worktree: {
                path: "/tmp/worktree",
                branch: "toy-box/session-worker",
                baseBranch: "main",
              },
              children: [
                {
                  id: "nested-worker",
                  title: "Review feature",
                  status: "idle",
                  kind: "standard",
                  directory: "/repo",
                  isRemote: false,
                  worktree: undefined,
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: "automation",
          title: "Managed work",
          status: "unread",
          kind: "automation",
          directory: undefined,
          isRemote: false,
          worktree: undefined,
          children: [],
        },
        {
          id: "hyper",
          title: "Hyper work",
          status: "running",
          kind: "hyper",
          directory: undefined,
          isRemote: false,
          worktree: undefined,
          children: [],
        },
      ],
      apps: [
        {
          id: "app-a",
          definitionId: "kanban",
          title: "Launch",
          revision: 4,
          updatedAt: "2026-07-28T01:00:00.000Z",
          accepts: ["text/markdown"],
        },
      ],
      shares: [
        {
          id: "share-a",
          sourceAppId: "app-b",
          targetAppId: "app-a",
          mimeType: "text/markdown",
          content: "# Ship the release",
          createdAt: "2026-07-28T00:30:00.000Z",
        },
      ],
      models: [
        {
          id: "gpt-5",
          name: "GPT-5",
          supportedReasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "high",
          supportedContextTiers: [
            { name: "default", tokenWindow: 264_000 },
            { name: "future_tier", tokenWindow: 1_000_000 },
          ],
        },
      ],
      defaultModel: {
        name: "gpt-5",
        reasoningEffort: "low",
      },
      openSessionIds: ["standard"],
      openFiles: [],
      workers: [
        {
          sessionId: "app-worker",
          name: "Generate expression",
          metadata: { requestId: "request-a" },
        },
      ],
    });
    expect(projection.defaultModel).toBe(defaultModel);

    const artifactProjection = projectAppWorkspace({
      ...source,
      appId: undefined,
    });
    expect(artifactProjection.shares).toEqual([]);
    expect(artifactProjection.workers).toEqual([]);
    expect(artifactProjection.sessions).toEqual(projection.sessions);
    expect(artifactProjection.apps).toEqual(projection.apps);

    expect(
      projectAppWorkspace(
        {
          ...source,
          workspace: { ...workspace },
          sessions: { ...sessionsState },
          models: [...models],
          openPanes: [...openPanes],
        },
        projection,
      ),
    ).toBe(projection);

    const changedWorker = projectAppWorkspace(
      {
        ...source,
        workspace: {
          ...workspace,
          workers: workspace.workers.map((worker) =>
            worker.sessionId === "app-worker" ? { ...worker, name: "Updated worker" } : worker,
          ),
        },
      },
      projection,
    );
    expect(changedWorker.workers).not.toBe(projection.workers);
    expect(changedWorker.sessions).toBe(projection.sessions);
    expect(changedWorker.apps).toBe(projection.apps);
    expect(changedWorker.shares).toBe(projection.shares);
    expect(changedWorker.models).toBe(projection.models);
    expect(changedWorker.defaultModel).toBe(projection.defaultModel);
    expect(changedWorker.openSessionIds).toBe(projection.openSessionIds);
    expect(changedWorker.openFiles).toBe(projection.openFiles);

    const changedChild = projectAppWorkspace(
      {
        ...source,
        workspace: {
          ...workspace,
          sessionStates: {
            ...workspace.sessionStates,
            "nested-worker": { status: "running" as const },
          },
        },
      },
      projection,
    );
    expect(changedChild.sessions).not.toBe(projection.sessions);
    expect(changedChild.sessions[0]?.children[0]?.children[0]?.status).toBe("running");
    expect(changedChild.apps).toBe(projection.apps);
    expect(changedChild.models).toBe(projection.models);
  });
});
