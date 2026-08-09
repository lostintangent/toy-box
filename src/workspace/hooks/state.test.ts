import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import { selectWorkspaceSessionActivity } from "./state";
import { sessionFile, workspaceFileId } from "@files/model";

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
      sessionStates: { "session-a": { status: "running", prompt: changedPrompt } },
    }));
    expect(status.updates()).toBe(1);
    expect(selectedPrompt.data()).toBe(promptAfterEdit);
    expect(selectedPrompt.updates()).toBe(1);
  });

  test("activity begins when a draft starts running", () => {
    const queryClient = createQueryClient();
    seedWorkspace(queryClient, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "draft", createdAt: 1 } },
    });
    const activity = observe(queryClient, (workspace) =>
      selectWorkspaceSessionActivity(workspace, "session-a"),
    );

    expect(activity.data()).toEqual({ running: false, unread: false, hasDraftPrompt: false });
    expect(activity.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: { "session-a": { status: "running" } },
    }));
    expect(activity.data()).toEqual({ running: true, unread: false, hasDraftPrompt: false });
    expect(activity.updates()).toBe(1);
  });

  test("projects whether a session has a non-empty draft prompt", () => {
    const queryClient = createQueryClient();
    seedWorkspace(queryClient, createEmptyWorkspaceState());
    const activity = observe(queryClient, (workspace) =>
      selectWorkspaceSessionActivity(workspace, "session-a"),
    );

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "idle",
          prompt: { text: "   ", origin: "client-a", updatedAt: 1 },
        },
      },
    }));
    expect(activity.data()?.hasDraftPrompt).toBe(false);
    expect(activity.updates()).toBe(0);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "idle",
          prompt: { text: "Follow up", origin: "client-a", updatedAt: 2 },
        },
      },
    }));
    expect(activity.data()?.hasDraftPrompt).toBe(true);
    expect(activity.updates()).toBe(1);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "idle",
          prompt: { text: "Changed follow up", origin: "client-a", updatedAt: 3 },
        },
      },
    }));
    expect(activity.data()?.hasDraftPrompt).toBe(true);
    expect(activity.updates()).toBe(1);

    updateWorkspace(queryClient, (workspace) => ({
      ...workspace,
      sessionStates: {
        "session-a": {
          status: "idle",
          prompt: { text: "", origin: "client-a", updatedAt: 4 },
        },
      },
    }));
    expect(activity.data()?.hasDraftPrompt).toBe(false);
    expect(activity.updates()).toBe(2);
  });

  test("projects workers for only one artifact", () => {
    const queryClient = createQueryClient();
    const worker = {
      type: "file" as const,
      sessionId: "artifact-worker-a",
      ephemeral: true,
      file: sessionFile("session-a", "plan.md"),
      name: "Respond to comment",
      metadata: { threadId: "thread-a" },
    };
    seedWorkspace(queryClient, {
      ...createEmptyWorkspaceState(),
      workers: [
        worker,
        {
          type: "file",
          sessionId: "artifact-worker-b",
          ephemeral: true,
          file: sessionFile("session-a", "other.md"),
          metadata: { threadId: "thread-b" },
        },
      ],
    });
    const workers = observe(queryClient, (workspace) =>
      workspace.workers.filter(
        (candidate) =>
          candidate.type === "file" &&
          workspaceFileId(candidate.file) === workspaceFileId(sessionFile("session-a", "plan.md")),
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
