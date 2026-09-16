import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { SessionMetadata, SessionSnapshot } from "./model";
import { createInitialSession, toSessionSnapshot } from "./model/reducer";
import type { SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";
import {
  addSessionIfMissing,
  applyWorkspaceEventToSessionQueries,
  removeSessionFromState,
  restoreSessionsState,
  snapshotSessionsState,
  upsertSessionInState,
} from "./queryCache";

function createSession(sessionId: string): SessionMetadata {
  return {
    sessionId,
    startTime: new Date("2026-02-14T00:00:00.000Z"),
    modifiedTime: new Date("2026-02-14T01:00:00.000Z"),
    title: "Existing session",
  };
}

function seedState(queryClient: QueryClient, state: Partial<SessionsState>): void {
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), {
    ...createEmptySessionsState(),
    ...state,
  });
}

function readState(queryClient: QueryClient): SessionsState {
  return snapshotSessionsState(queryClient) ?? createEmptySessionsState();
}

describe("session query cache", () => {
  test("creation and title updates retain one session and its directory", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-upserted-session";

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        startTime: new Date(100).toISOString(),
        modifiedTime: new Date(200).toISOString(),
        sessionType: "standard",
        directory: "/repo",
      },
    });
    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        title: "Named session",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      sessionId,
      startTime: new Date(100),
      modifiedTime: new Date(200),
      title: "Named session",
      directory: "/repo",
    });
  });

  test("worker upserts retain durable metadata and parentage", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-upsert";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        modifiedTime: "2026-02-14T02:00:00.000Z",
        title: "Updated",
        parentSessionId: "parent",
        sessionType: "worker",
        worktree: {
          branch: "feature",
          baseBranch: "main",
          path: "/tmp/worktree",
        },
      },
    });

    const state = readState(queryClient);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      sessionId,
      title: "Updated",
      modifiedTime: new Date("2026-02-14T02:00:00.000Z"),
    });
    expect(state.workerSessionParents).toEqual({ [sessionId]: "parent" });
    expect(state.worktrees[sessionId]).toMatchObject({ branch: "feature" });
  });

  test("classifies a parentless app worker", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-app-worker";

    upsertSessionInState(queryClient, {
      sessionId,
      sessionType: "worker",
    });

    expect(readState(queryClient).workerSessionParents).toEqual({ [sessionId]: null });
  });

  test("does not admit private Agent sessions to the list", () => {
    const queryClient = new QueryClient();

    upsertSessionInState(queryClient, {
      sessionId: "private-agent-session",
      sessionType: "agent",
      worktree: { branch: "agent", baseBranch: "main", path: "/tmp/agent" },
    });

    expect(readState(queryClient)).toEqual(createEmptySessionsState());
  });

  test("does not synthesize a missing session from an unclassified metadata patch", () => {
    const queryClient = new QueryClient();

    upsertSessionInState(queryClient, {
      sessionId: "unprojected-session",
      title: "Partial update",
    });

    expect(readState(queryClient)).toEqual(createEmptySessionsState());
  });

  test("upsert preserves title when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-title-preserved";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        modifiedTime: "2026-02-14T02:00:00.000Z",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions[0]?.title).toBe("Existing session");
  });

  test("renaming preserves catalog metadata and its modified time", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-modified-preserved";
    seedState(queryClient, {
      sessions: [
        {
          ...createSession(sessionId),
          directory: "/repo/src",
          gitRoot: "/repo",
          repository: "owner/repo",
          branch: "main",
        },
      ],
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        title: "Renamed session",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions[0]).toMatchObject({
      title: "Renamed session",
      modifiedTime: new Date("2026-02-14T01:00:00.000Z"),
      directory: "/repo/src",
      gitRoot: "/repo",
      repository: "owner/repo",
      branch: "main",
    });
  });

  test("delete removes durable session-side structures", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-delete";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
      workerSessionParents: { [sessionId]: "parent" },
      worktrees: {
        [sessionId]: {
          branch: "feature",
          baseBranch: "main",
          path: "/tmp/worktree",
        },
      },
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.deleted",
      sessionId,
    });

    const state = readState(queryClient);
    expect(state.sessions).toEqual([]);
    expect(state.workerSessionParents).toEqual({});
    expect(state.worktrees).toEqual({});
  });

  test("touch invalidates the session list and affected detail", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-touched";
    const otherSessionId = "toy-box-untouched";
    seedState(queryClient, { sessions: [createSession(sessionId)] });
    for (const id of [sessionId, otherSessionId]) {
      queryClient.setQueryData(sessionQueries.detail(id).queryKey, {
        id,
        messages: [],
        queuedMessages: [],
        status: "idle",
        reasoningContent: "",
      });
    }
    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.touched",
      sessionId,
    });

    expect(queryClient.getQueryState(sessionQueries.stateKey())?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(sessionId).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(otherSessionId).queryKey)?.isInvalidated,
    ).toBe(false);
  });

  test("automation insertion adds a missing session without replacing existing metadata", () => {
    const queryClient = new QueryClient();
    const existing = createSession("automation-session");
    seedState(queryClient, { sessions: [existing] });

    addSessionIfMissing(queryClient, {
      ...existing,
      title: "Replacement",
    });
    addSessionIfMissing(queryClient, createSession("new-automation-session"));

    expect(readState(queryClient).sessions).toEqual([
      createSession("new-automation-session"),
      existing,
    ]);
  });

  test("optimistic session changes can restore their previous state", () => {
    const queryClient = new QueryClient();
    const existing = createSession("optimistic-session");
    seedState(queryClient, { sessions: [existing] });
    const previousState = snapshotSessionsState(queryClient);

    removeSessionFromState(queryClient, existing.sessionId);
    expect(readState(queryClient).sessions).toEqual([]);

    if (!previousState) throw new Error("Expected seeded sessions state");
    restoreSessionsState(queryClient, previousState);
    upsertSessionInState(queryClient, {
      sessionId: existing.sessionId,
      title: "Optimistic rename",
    });
    expect(readState(queryClient).sessions[0]?.title).toBe("Optimistic rename");

    restoreSessionsState(queryClient, previousState);
    expect(readState(queryClient)).toEqual(previousState);
  });
});

describe("session deletion cache boundary", () => {
  test("retires the transcript and cursor before a managed ID is reused", async () => {
    const client = new QueryClient();
    const sessionId = "automation";
    const queryKey = sessionQueries.detail(sessionId).queryKey;
    const previous = {
      ...toSessionSnapshot(
        sessionId,
        createInitialSession({
          messages: [{ role: "assistant", content: "Previous run" }],
          artifacts: ["old.md"],
          model: { provider: "copilot", name: "previous-model" },
        }),
      ),
      lastSeenEventId: 100,
    };
    client.setQueryData(queryKey, previous);
    const history = Promise.withResolvers<typeof previous>();
    const read = client.fetchQuery({ queryKey, queryFn: () => history.promise });

    applyWorkspaceEventToSessionQueries(client, { type: "session.deleted", sessionId });
    const empty = toSessionSnapshot(sessionId, createInitialSession());
    expect(client.getQueryData<SessionSnapshot>(queryKey)).toEqual(empty);

    history.resolve(previous);
    await read.catch(() => {});
    expect(client.getQueryData<SessionSnapshot>(queryKey)).toEqual(empty);
    client.clear();
  });

  test("does not populate history caches for sessions this client has never opened", () => {
    const client = new QueryClient();
    applyWorkspaceEventToSessionQueries(client, {
      type: "session.deleted",
      sessionId: "unopened",
    });
    expect(client.getQueryData(sessionQueries.detail("unopened").queryKey)).toBeUndefined();
    client.clear();
  });
});
