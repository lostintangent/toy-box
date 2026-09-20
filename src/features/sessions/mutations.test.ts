import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import type { Session, SessionState } from "./model";
import { createInitialSessionState } from "./model/reducer";
import { sessionMutations } from "./mutations";
import type { SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";
import { snapshotSessionsState } from "./queryCache";

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

    expect(readWorkspaceState(queryClient)).toEqual({
      ...createEmptyWorkspaceState(),
      hyperSessionIds: [sessionId],
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

  test("trusts successful queue events and invalidates rejected queue commands", async () => {
    const acceptedClient = createQueryClient();
    await new MutationObserver(acceptedClient, {
      ...sessionMutations.cancelQueuedMessage(sessionId),
      mutationFn: async () => true,
    }).mutate("message-a");
    expect(isSessionInvalidated(acceptedClient)).toBe(false);

    const rejectedClient = createQueryClient();
    await new MutationObserver(rejectedClient, {
      ...sessionMutations.steerQueuedMessage(sessionId),
      mutationFn: async () => false,
    }).mutate("message-b");
    expect(isSessionInvalidated(rejectedClient)).toBe(true);
  });

  test("trusts accepted question answers and refreshes rejected requests", async () => {
    const answer = {
      requestId: "request-1",
      answer: "SQLite",
      wasFreeform: false,
    };
    const acceptedClient = createQueryClient();
    await new MutationObserver(acceptedClient, {
      ...sessionMutations.answerSessionQuestion(sessionId),
      mutationFn: async () => true,
    }).mutate(answer);
    expect(isSessionInvalidated(acceptedClient)).toBe(false);

    const rejectedClient = createQueryClient();
    await new MutationObserver(rejectedClient, {
      ...sessionMutations.answerSessionQuestion(sessionId),
      mutationFn: async () => false,
    }).mutate(answer);
    expect(isSessionInvalidated(rejectedClient)).toBe(true);
  });

  test("leaves session data alone after queue errors and refreshes after aborts", async () => {
    const failedClient = createQueryClient();
    const failedMutation = new MutationObserver(failedClient, {
      ...sessionMutations.cancelQueuedMessage(sessionId),
      mutationFn: async () => {
        throw new Error("network unavailable");
      },
    });
    await expect(failedMutation.mutate("message-a")).rejects.toThrow("network unavailable");
    expect(isSessionInvalidated(failedClient)).toBe(false);

    const abortedClient = createQueryClient();
    await new MutationObserver(abortedClient, {
      ...sessionMutations.abortSession(sessionId),
      mutationFn: async () => true,
    }).mutate();
    expect(isSessionInvalidated(abortedClient)).toBe(true);
  });

  test("replaces the detail cache with the authoritative rewind snapshot", async () => {
    const queryClient = createQueryClient();
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
    ).toEqual(rewoundSnapshot);
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

  test("optimistically renames sessions and restores failed renames", async () => {
    const queryClient = createSessionListQueryClient();
    const renameMutation = new MutationObserver(queryClient, {
      ...sessionMutations.renameSession(sessionId),
      mutationFn: async () => {
        expect(readSession(queryClient).title).toBe("Optimistic name");
        throw new Error("rename failed");
      },
    });

    await expect(renameMutation.mutate("Optimistic name")).rejects.toThrow("rename failed");
    expect(readSession(queryClient)).toEqual(session);
  });

  test("optimistically deletes sessions and restores failed deletions", async () => {
    const queryClient = createSessionListQueryClient();
    const deleteMutation = new MutationObserver(queryClient, {
      ...sessionMutations.deleteSession(sessionId),
      mutationFn: async () => {
        expect(readSessionsState(queryClient).sessions).toEqual([]);
        throw new Error("delete failed");
      },
    });

    await expect(deleteMutation.mutate()).rejects.toThrow("delete failed");
    expect(readSession(queryClient)).toEqual(session);
  });

  test("projects successful deletion into shared workspace state", async () => {
    const queryClient = createSessionListQueryClient();

    await new MutationObserver(queryClient, {
      ...sessionMutations.deleteSession(sessionId),
      mutationFn: async () => true,
    }).mutate();

    expect(readSessionsState(queryClient).sessions).toEqual([]);
    expect(readWorkspaceState(queryClient)).toEqual(createEmptyWorkspaceState());
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQueries.detail(sessionId).queryKey, createInitialSessionState());
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function isSessionInvalidated(queryClient: QueryClient): boolean {
  return (
    queryClient.getQueryState(sessionQueries.detail(sessionId).queryKey)?.isInvalidated ?? false
  );
}

function isSessionsStateInvalidated(queryClient: QueryClient): boolean {
  return queryClient.getQueryState(sessionQueries.stateKey())?.isInvalidated ?? false;
}

function createSessionListQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), {
    ...createEmptySessionsState(),
    sessions: [session],
  });
  queryClient.setQueryData(workspaceQueries.stateKey(), {
    ...createEmptyWorkspaceState(),
    sessionStates: { [sessionId]: { status: "unread" } },
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function createWorkspaceQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readSessionsState(queryClient: QueryClient): SessionsState {
  const state = snapshotSessionsState(queryClient);
  if (!state) throw new Error("Sessions state was not cached");
  return state;
}

function readSession(queryClient: QueryClient): Session {
  const cachedSession = readSessionsState(queryClient).sessions[0];
  if (!cachedSession) throw new Error("Session was not cached");
  return cachedSession;
}

function readWorkspaceState(queryClient: QueryClient): WorkspaceState {
  const state = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!state) throw new Error("Workspace state was not cached");
  return state;
}
