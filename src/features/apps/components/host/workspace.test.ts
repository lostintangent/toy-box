import { describe, expect, test } from "bun:test";
import type { AppList } from "@apps/model";
import type { SessionsState } from "@sessions/model";
import type { ModelInfo } from "@providers/model";
import { createLinkedSessionPane } from "@workspace/model/panes";
import { projectAppWorkspace } from "./workspace";

describe("app workspace projection", () => {
  test("exposes sessions with governance kinds and hides inbox implementation sessions", () => {
    const workspace = {
      sessionStates: {
        standard: { status: "running" as const, since: 1 },
        "session-worker": { status: "unread" as const },
        automation: { status: "unread" as const },
        hyper: { status: "running" as const, since: 1 },
      },
      hyperSessionIds: ["hyper"],
      workers: [
        {
          createdAt: new Date(0).toISOString(),
          type: "app" as const,
          sessionId: "app-worker",
          ephemeral: true,
          appId: "app-a",
          name: "Generate expression",
          metadata: { requestId: "request-a" },
        },
        {
          createdAt: new Date(0).toISOString(),
          type: "app" as const,
          sessionId: "other-app-worker",
          ephemeral: false,
          appId: "app-b",
        },
      ],
    };
    const apps: AppList = {
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
      definitions: [
        {
          id: "kanban",
          title: "Kanban",
          color: "#f59e0b" as const,
          state: { schema: { type: "object" as const }, default: {} },
          accepts: ["text/markdown"],
          revision: "definition-a",
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
    };
    const sessionsState: SessionsState = {
      sessions: [
        {
          id: "inbox",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
        {
          id: "standard",
          provider: { id: "codex" },
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Standard work",
          context: {
            directory: "/repo",
            repository: "owner/repo",
            gitRoot: "/repo",
            branch: "main",
          },
        },
        {
          id: "automation",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Managed work",
        },
        {
          id: "hyper",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
        },
        {
          id: "app-worker",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Hidden worker",
        },
        {
          id: "session-worker",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Implement feature",
          context: { directory: "/tmp/worktree" },
        },
        {
          id: "nested-worker",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Review feature",
          context: { directory: "/tmp/worktree" },
        },
      ],
      worktrees: {
        "session-worker": {
          path: "/tmp/worktree",
          branch: "toy-box/session-worker",
          baseBranch: "main",
        },
      },
      ownership: {
        automation: { type: "automation" },
        inbox: { type: "worker", parentSessionId: null },
        "app-worker": { type: "worker", parentSessionId: null },
        "session-worker": { type: "worker", parentSessionId: "standard" },
        "nested-worker": { type: "worker", parentSessionId: "session-worker" },
      },
    };

    const models: ModelInfo[] = [
      {
        id: "gpt-5",
        provider: "copilot",
        providerName: "GitHub Copilot",
        name: "GPT-5",
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "high",
        supportedContextTiers: [
          { name: "default", tokenWindow: 264_000 },
          { name: "future_tier", tokenWindow: 1_000_000 },
        ],
      },
      { id: "gpt-5", provider: "codex", providerName: "Codex", name: "GPT-5" },
    ];
    const openPanes = [createLinkedSessionPane("standard")];
    const defaultModel = { provider: "copilot", name: "gpt-5", reasoningEffort: "low" };
    const source = {
      workspace,
      apps,
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
          provider: { id: "codex" },
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Standard work",
          status: "running",
          kind: "standard",
          context: {
            directory: "/repo",
            repository: "owner/repo",
            gitRoot: "/repo",
            branch: "main",
          },
          worktree: undefined,
          children: [
            {
              id: "session-worker",
              createdAt: new Date("2026-07-28T00:00:00.000Z"),
              updatedAt: new Date("2026-07-28T01:00:00.000Z"),
              title: "Implement feature",
              status: "unread",
              kind: "standard",
              context: { directory: "/tmp/worktree" },
              worktree: {
                path: "/tmp/worktree",
                branch: "toy-box/session-worker",
                baseBranch: "main",
              },
              children: [
                {
                  id: "nested-worker",
                  createdAt: new Date("2026-07-28T00:00:00.000Z"),
                  updatedAt: new Date("2026-07-28T01:00:00.000Z"),
                  title: "Review feature",
                  status: "idle",
                  kind: "standard",
                  context: { directory: "/tmp/worktree" },
                  worktree: undefined,
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: "automation",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          title: "Managed work",
          status: "unread",
          kind: "automation",
          worktree: undefined,
          children: [],
        },
        {
          id: "hyper",
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          status: "running",
          kind: "hyper",
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
      models,
      defaultModel,
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
          apps: { ...apps },
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
    expect(changedWorker.workers[0]?.name).toBe("Updated worker");
    expect(changedWorker.sessions).toBe(projection.sessions);

    const changedChild = projectAppWorkspace(
      {
        ...source,
        workspace: {
          ...workspace,
          sessionStates: {
            ...workspace.sessionStates,
            "nested-worker": { status: "running" as const, since: 1 },
          },
        },
      },
      projection,
    );
    expect(changedChild.sessions[0]?.children[0]?.children[0]?.status).toBe("running");

    const changedApp = projectAppWorkspace(
      {
        ...source,
        apps: {
          ...apps,
          apps: apps.apps.map((app) => ({ ...app, title: "Renamed launch", revision: 5 })),
          shares: [],
        },
      },
      projection,
    );
    expect(changedApp.apps[0]?.title).toBe("Renamed launch");
    expect(changedApp.shares).toEqual([]);
    expect(changedApp.sessions).toBe(projection.sessions);
    expect(changedApp.workers).toBe(projection.workers);
  });
});
