import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { workspaceQueries } from "@/lib/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@/lib/workspace/state";
import { selectInboxEntries, selectWorkspaceSessionActivity } from "./state";

describe("workspace query selectors", () => {
  test("projects one session without notifying it about another", () => {
    const queryClient = createQueryClient();
    seedWorkspace(queryClient, createEmptyWorkspaceState());
    const status = observe(
      queryClient,
      (workspace) => workspace.sessionStates["session-a"]?.status ?? "idle",
    );

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-b": { status: "running" } },
    }));
    expect(status.data()).toBe("idle");
    expect(status.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        ...workspace.sessionStates,
        "session-a": { status: "running" },
      },
    }));
    expect(status.data()).toBe("running");
    expect(status.updates()).toBe(1);
  });

  test("status and prompt selectors ignore changes they do not expose", () => {
    const queryClient = createQueryClient();
    const prompt = { text: "draft", origin: "client-a", updatedAt: 1 };
    const changedPrompt = { text: "changed", origin: "client-a", updatedAt: 2 };
    seedWorkspace(queryClient, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "draft", createdAt: 1, prompt } },
    });
    const status = observe(
      queryClient,
      (workspace) => workspace.sessionStates["session-a"]?.status ?? "idle",
    );
    const selectedPrompt = observe(
      queryClient,
      (workspace) => workspace.sessionStates["session-a"]?.prompt ?? null,
    );

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "draft",
          createdAt: 1,
          prompt: changedPrompt,
        },
      },
    }));
    expect(status.updates()).toBe(0);
    expect(selectedPrompt.updates()).toBe(1);
    const promptAfterEdit = selectedPrompt.data();

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-a": { status: "creating", createdAt: 1, prompt: changedPrompt } },
    }));
    expect(status.updates()).toBe(1);
    expect(selectedPrompt.data()).toBe(promptAfterEdit);
    expect(selectedPrompt.updates()).toBe(1);
  });

  test("activity consumers ignore the creating-to-running handoff", () => {
    const queryClient = createQueryClient();
    seedWorkspace(queryClient, createEmptyWorkspaceState());
    const activity = observe(queryClient, (workspace) =>
      selectWorkspaceSessionActivity(workspace, "session-a"),
    );

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-a": { status: "creating", createdAt: 1 } },
    }));
    expect(activity.data()).toEqual({ running: true, unread: false });
    expect(activity.updates()).toBe(1);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-a": { status: "running" } },
    }));
    expect(activity.data()).toEqual({ running: true, unread: false });
    expect(activity.updates()).toBe(1);
  });

  test("collection selectors ignore session details they do not expose", () => {
    const queryClient = createQueryClient();
    const entry = { id: "session-a", createdAt: "2026-01-01T00:00:00.000Z" };
    const automation = {
      id: "automation-a",
      title: "Daily summary",
      prompt: "Summarize repo status.",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: "2026-01-02T09:00:00.000Z",
    };
    seedWorkspace(queryClient, {
      ...createEmptyWorkspaceState(),
      inboxEntries: [entry],
      sessionStates: { "session-a": { status: "running" } },
    });
    const drafts = observe(queryClient, (workspace) =>
      Object.entries(workspace.sessionStates).filter(
        ([, state]) => state.status === "draft" || state.status === "creating",
      ),
    );
    const inbox = observe(queryClient, selectInboxEntries);
    const hasUnread = observe(queryClient, (workspace) =>
      workspace.inboxEntries.some(
        (candidate) => workspace.sessionStates[candidate.id]?.status === "unread",
      ),
    );
    const workspaceShell = observe(queryClient, (workspace) => ({
      automationSessionIds: workspace.automations.map((candidate) => candidate.id),
      environment: workspace.environment,
      hyperSessionIds: workspace.hyperSessionIds,
      inboxSessionIds: workspace.inboxEntries.map((candidate) => candidate.id),
    }));

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "running",
          prompt: { text: "typing", origin: "client-a", updatedAt: 1 },
        },
      },
    }));
    expect(drafts.updates()).toBe(0);
    expect(inbox.updates()).toBe(0);
    expect(hasUnread.updates()).toBe(0);
    expect(workspaceShell.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-a": { status: "unread" } },
    }));
    expect(hasUnread.data()).toBe(true);
    expect(drafts.updates()).toBe(0);
    expect(inbox.updates()).toBe(0);
    expect(hasUnread.updates()).toBe(1);
    expect(workspaceShell.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      inboxEntries: [{ ...entry, message: "Ready" }],
    }));
    expect(inbox.updates()).toBe(1);
    expect(workspaceShell.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      automations: [automation],
    }));
    expect(workspaceShell.updates()).toBe(1);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      automations: [{ ...automation, lastRunAt: "2026-01-02T09:01:00.000Z" }],
    }));
    expect(workspaceShell.updates()).toBe(1);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      automations: [
        automation,
        {
          ...automation,
          id: "automation-b",
          title: "Weekly summary",
        },
      ],
    }));
    expect(workspaceShell.updates()).toBe(2);
  });

  test("projects workers for only one artifact", () => {
    const queryClient = createQueryClient();
    const worker = {
      sessionId: "artifact-worker-a",
      sourceSessionId: "session-a",
      path: "plan.md",
      name: "Respond to comment",
      metadata: { threadId: "thread-a" },
    };
    seedWorkspace(queryClient, {
      ...createEmptyWorkspaceState(),
      artifactWorkers: [
        worker,
        {
          sessionId: "artifact-worker-b",
          sourceSessionId: "session-a",
          path: "other.md",
          metadata: { threadId: "thread-b" },
        },
      ],
    });
    const workers = observe(queryClient, (workspace) =>
      workspace.artifactWorkers.filter(
        (candidate) => candidate.sourceSessionId === "session-a" && candidate.path === "plan.md",
      ),
    );
    expect(workers.data()).toEqual([worker]);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "artifact-worker-a": { status: "running" } },
    }));
    expect(workers.updates()).toBe(0);
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function seedWorkspace(queryClient: QueryClient, state: WorkspaceState): void {
  queryClient.setQueryData(workspaceQueries.stateKey(), state);
}

function updateWorkspace(
  queryClient: QueryClient,
  update: (workspace: WorkspaceState) => WorkspaceState,
): void {
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), (workspace) =>
    update(workspace!),
  );
}

function observe<T>(queryClient: QueryClient, select: (workspace: WorkspaceState) => T) {
  const observer = new QueryObserver(queryClient, {
    ...workspaceQueries.state(),
    enabled: false,
    notifyOnChangeProps: ["data"],
    select,
  });
  let updateCount = 0;
  const unsubscribe = observer.subscribe(() => updateCount++);
  onTestFinished(unsubscribe);

  return {
    data: () => observer.getCurrentResult().data,
    updates: () => updateCount,
  };
}
