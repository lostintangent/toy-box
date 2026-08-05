import { describe, expect, test } from "bun:test";
import type { SessionsState } from "@/functions/sessions";
import type { ModelInfo } from "@/types";
import { createEmptyWorkspaceState } from "@/lib/workspace/state/reducer";
import { createLinkedSessionPane } from "@/lib/workspace/panes";
import { projectAppWorkspace } from "./workspace";

describe("app workspace projection", () => {
  test("exposes standard session metadata and hides managed implementation sessions", () => {
    const workspace = {
      ...createEmptyWorkspaceState(),
      sessionStates: {
        standard: { status: "running" as const },
        "session-worker": { status: "unread" as const },
        automation: { status: "unread" as const },
      },
      automations: [
        {
          id: "automation",
          title: "Scheduled",
          prompt: "Run",
          model: { name: "gpt-5" },
          cron: "0 9 * * *",
          createdAt: "2026-07-28T00:00:00.000Z",
          updatedAt: "2026-07-28T00:00:00.000Z",
          nextRunAt: "2026-07-29T09:00:00.000Z",
        },
      ],
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

    const models: ModelInfo[] = [
      {
        id: "gpt-5",
        name: "GPT-5",
        capabilities: {
          supports: { vision: false, reasoningEffort: true },
          limits: { max_context_window_tokens: 200_000 },
        },
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "high",
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
          directory: "/repo",
          isRemote: false,
          worktree: undefined,
          children: [
            {
              id: "session-worker",
              title: "Implement feature",
              status: "unread",
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
                  directory: "/repo",
                  isRemote: false,
                  worktree: undefined,
                  children: [],
                },
              ],
            },
          ],
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
