import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import type { Session, SessionState } from "./model";
import type { SessionsActivity } from "./model/activity";
import { createInitialSessionState } from "./model/reducer";
import { sessionMutations } from "./mutations";
import type { SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";

const sessionId = "session-a";
const session = {
  id: sessionId,
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
  updatedAt: new Date("2026-08-01T12:01:00.000Z"),
  title: "Original name",
} satisfies Session;

describe("session mutation options", () => {
  test("publishes a draft session before its creation request resolves", async () => {
    const queryClient = createWorkspaceQueryClient();
    let resolveRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const createMutation = new MutationObserver(queryClient, {
      ...sessionMutations.createSession(),
      mutationFn: () => request,
    });

    const creation = createMutation.mutate({
      sessionId,
      createdAt: 42,
      artifact: { path: "plan.md", content: "# Plan" },
      hyper: true,
    });

    const workspace = createEmptyWorkspaceState();
    expect(readWorkspaceState(queryClient)).toEqual({
      ...workspace,
      settings: { ...workspace.settings, hyperSessionId: sessionId },
    });

    expect(readSessionsState(queryClient).sessions).toEqual([
      {
        id: sessionId,
        createdAt: new Date(42),
        updatedAt: new Date(42),
        artifactPath: "plan.md",
      },
    ]);

    resolveRequest();
    await creation;
  });

  test("removes the optimistic session when creation fails", async () => {
    const queryClient = createWorkspaceQueryClient();
    const createMutation = new MutationObserver(queryClient, {
      ...sessionMutations.createSession(),
      mutationFn: async () => {
        throw new Error("creation failed");
      },
    });

    await expect(createMutation.mutate({ sessionId, createdAt: 42 })).rejects.toThrow(
      "creation failed",
    );

    expect(readWorkspaceState(queryClient)).toEqual(createEmptyWorkspaceState());
    expect(readSessionsState(queryClient).sessions).toEqual([]);
  });

  test("settles an abort while the detail is watched and restarts its observation", async () => {
    const queryClient = createQueryClient();
    let observations = 0;
    const watcher = new QueryObserver(queryClient, {
      queryKey: sessionQueries.detail(sessionId).queryKey,
      // An observation lasts until nothing watches the detail.
      queryFn: ({ signal }) => {
        observations++;
        return new Promise<SessionState>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
      },
    });
    onTestFinished(watcher.subscribe(() => {}));
    expect(observations).toBe(1);

    await new MutationObserver(queryClient, {
      ...sessionMutations.abortSession(sessionId),
      mutationFn: async () => true,
    }).mutate();

    expect(observations).toBe(2);
  });

  test("replaces the detail cache with the authoritative rewind snapshot", async () => {
    const queryClient = createQueryClient();
    const model = { provider: "copilot", name: "claude-haiku-5.5" };
    queryClient.setQueryData<SessionState>(sessionQueries.detail(sessionId).queryKey, {
      ...createInitialSessionState(),
      model,
    });
    const rewoundSnapshot: SessionState = {
      ...createInitialSessionState(),
      messages: [{ role: "user", content: "retained" }],
    };
    const mutation = new MutationObserver(queryClient, {
      ...sessionMutations.rewindSession(sessionId, "2026-08-14T20:00:00.000Z"),
      mutationFn: async () => rewoundSnapshot,
    });

    await mutation.mutate();

    expect(
      queryClient.getQueryData<SessionState>(sessionQueries.detail(sessionId).queryKey),
    ).toEqual({ ...rewoundSnapshot, model });
  });

  test("refreshes durable session state after successful worktree operations", async () => {
    for (const operation of ["mergeWorktree", "applyWorktree"] as const) {
      const queryClient = createSessionListQueryClient();
      await new MutationObserver(queryClient, {
        ...sessionMutations[operation](sessionId),
        mutationFn: async () => undefined,
      }).mutate();

      expect(isSessionsStateInvalidated(queryClient)).toBe(true);
    }
  });

  test("leaves durable session state alone when a worktree operation fails", async () => {
    const queryClient = createSessionListQueryClient();
    const mergeMutation = new MutationObserver(queryClient, {
      ...sessionMutations.mergeWorktree(sessionId),
      mutationFn: async () => {
        throw new Error("merge failed");
      },
    });

    await expect(mergeMutation.mutate()).rejects.toThrow("merge failed");
    expect(isSessionsStateInvalidated(queryClient)).toBe(false);
  });

  test("optimistically renames sessions and refreshes the catalog after a failed rename", async () => {
    const queryClient = createSessionListQueryClient();
    const renameMutation = new MutationObserver(queryClient, {
      ...sessionMutations.renameSession(sessionId),
      mutationFn: async () => {
        expect(readSession(queryClient).title).toBe("Optimistic name");
        throw new Error("rename failed");
      },
    });

    await expect(renameMutation.mutate("Optimistic name")).rejects.toThrow("rename failed");
    expect(isSessionsStateInvalidated(queryClient)).toBe(true);
  });

  test("optimistically deletes sessions and refreshes the catalog after a failed deletion", async () => {
    const queryClient = createSessionListQueryClient();
    const deleteMutation = new MutationObserver(queryClient, {
      ...sessionMutations.deleteSession(sessionId),
      mutationFn: async () => {
        expect(readSessionsState(queryClient).sessions).toEqual([]);
        throw new Error("delete failed");
      },
    });

    await expect(deleteMutation.mutate()).rejects.toThrow("delete failed");
    expect(isSessionsStateInvalidated(queryClient)).toBe(true);
    expect(readActivity(queryClient)).toEqual({ [sessionId]: { status: "unread" } });
  });

  test("projects successful deletion into shared session activity", async () => {
    const queryClient = createSessionListQueryClient();

    await new MutationObserver(queryClient, {
      ...sessionMutations.deleteSession(sessionId),
      mutationFn: async () => true,
    }).mutate();

    expect(readSessionsState(queryClient).sessions).toEqual([]);
    expect(readActivity(queryClient)).toEqual({});
  });

  test("marks a session read before the server confirms and refreshes activity on failure", async () => {
    const queryClient = createSessionListQueryClient();
    const markRead = new MutationObserver(queryClient, {
      ...sessionMutations.markRead(sessionId),
      mutationFn: async () => {
        expect(readActivity(queryClient)).toEqual({});
        throw new Error("read failed");
      },
    });

    await expect(markRead.mutate()).rejects.toThrow("read failed");
    expect(queryClient.getQueryState(sessionQueries.activity.queryKey)?.isInvalidated).toBe(true);
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQueries.detail(sessionId).queryKey, createInitialSessionState());
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function isSessionsStateInvalidated(queryClient: QueryClient): boolean {
  return queryClient.getQueryState(sessionQueries.state.queryKey)?.isInvalidated ?? false;
}

function createSessionListQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQueries.state.queryKey, {
    ...createEmptySessionsState(),
    sessions: [session],
  });
  queryClient.setQueryData(sessionQueries.activity.queryKey, {
    [sessionId]: { status: "unread" },
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function createWorkspaceQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(workspaceQueries.state.queryKey, createEmptyWorkspaceState());
  queryClient.setQueryData(sessionQueries.state.queryKey, createEmptySessionsState());
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readSessionsState(queryClient: QueryClient): SessionsState {
  const state = queryClient.getQueryData(sessionQueries.state.queryKey);
  if (!state) throw new Error("Sessions state was not cached");
  return state;
}

function readSession(queryClient: QueryClient): Session {
  const cachedSession = readSessionsState(queryClient).sessions[0];
  if (!cachedSession) throw new Error("Session was not cached");
  return cachedSession;
}

function readActivity(queryClient: QueryClient): SessionsActivity | undefined {
  return queryClient.getQueryData(sessionQueries.activity.queryKey);
}

function readWorkspaceState(queryClient: QueryClient): WorkspaceState {
  const state = queryClient.getQueryData(workspaceQueries.state.queryKey);
  if (!state) throw new Error("Workspace state was not cached");
  return state;
}
