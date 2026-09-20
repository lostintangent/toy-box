import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Session, SessionState } from "./model";
import { createInitialSessionState } from "./model/reducer";
import type { SessionsState } from "./model";
import { createEmptySessionsState, selectNonWorkerSessions, sessionQueries } from "./queries";
import {
  applyWorkspaceEventToSessionQueries,
  removeSessionFromState,
  restoreSessionsState,
  snapshotSessionsState,
  upsertSessionInState,
} from "./queryCache";

function createSession(sessionId: string): Session {
  return {
    id: sessionId,
    createdAt: new Date("2026-02-14T00:00:00.000Z"),
    updatedAt: new Date("2026-02-14T01:00:00.000Z"),
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
  test("first-turn promotion and renaming retain the session's identity and initial artifact", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-upserted-session";

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        createdAt: new Date(100).toISOString(),
        updatedAt: new Date(100).toISOString(),
        sessionType: "standard",
        artifactPath: "document.md",
      },
    });
    expect(readState(queryClient).sessions[0]?.provider).toBeUndefined();
    upsertSessionInState(queryClient, {
      id: sessionId,
      provider: { id: "codex" },
      updatedAt: new Date(200).toISOString(),
      context: { directory: "/repo" },
    });
    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        title: "Named session",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      id: sessionId,
      createdAt: new Date(100),
      updatedAt: new Date(200),
      title: "Named session",
      provider: { id: "codex" },
      context: { directory: "/repo" },
      artifactPath: "document.md",
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
        id: sessionId,
        updatedAt: "2026-02-14T02:00:00.000Z",
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
      id: sessionId,
      title: "Updated",
      updatedAt: new Date("2026-02-14T02:00:00.000Z"),
    });
    expect(state.workerSessionParents).toEqual({ [sessionId]: "parent" });
    expect(state.worktrees[sessionId]).toMatchObject({ branch: "feature" });
  });

  test("classifies a parentless app worker", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-app-worker";

    upsertSessionInState(queryClient, {
      id: sessionId,
      sessionType: "worker",
    });

    expect(readState(queryClient).workerSessionParents).toEqual({ [sessionId]: null });
  });

  test("retains Channel worker metadata without projecting it as an ordinary session", () => {
    const queryClient = new QueryClient();

    upsertSessionInState(queryClient, {
      id: "channel-worker-session",
      sessionType: "worker",
      worktree: { branch: "agent", baseBranch: "main", path: "/tmp/agent" },
    });

    const state = readState(queryClient);
    expect(state.workerSessionParents).toEqual({ "channel-worker-session": null });
    expect(state.worktrees).toHaveProperty("channel-worker-session");
    expect(selectNonWorkerSessions(state)).toEqual([]);
  });

  test("does not synthesize a missing session from an unclassified metadata patch", () => {
    const queryClient = new QueryClient();

    upsertSessionInState(queryClient, {
      id: "unprojected-session",
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
        id: sessionId,
        updatedAt: "2026-02-14T02:00:00.000Z",
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
          context: {
            directory: "/repo/src",
            gitRoot: "/repo",
            repository: "owner/repo",
            branch: "main",
          },
        },
      ],
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        title: "Renamed session",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions[0]).toMatchObject({
      title: "Renamed session",
      updatedAt: new Date("2026-02-14T01:00:00.000Z"),
      context: {
        directory: "/repo/src",
        gitRoot: "/repo",
        repository: "owner/repo",
        branch: "main",
      },
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
      sessionId: sessionId,
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
      queryClient.setQueryData(sessionQueries.detail(id).queryKey, createInitialSessionState());
    }
    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.touched",
      sessionId: sessionId,
    });

    expect(queryClient.getQueryState(sessionQueries.stateKey())?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(sessionId).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(otherSessionId).queryKey)?.isInvalidated,
    ).toBe(false);
  });

  test("optimistic session changes can restore their previous state", () => {
    const queryClient = new QueryClient();
    const existing = createSession("optimistic-session");
    seedState(queryClient, { sessions: [existing] });
    const previousState = snapshotSessionsState(queryClient);

    removeSessionFromState(queryClient, existing.id);
    expect(readState(queryClient).sessions).toEqual([]);

    if (!previousState) throw new Error("Expected seeded sessions state");
    restoreSessionsState(queryClient, previousState);
    upsertSessionInState(queryClient, {
      id: existing.id,
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
      ...createInitialSessionState({
        messages: [{ role: "assistant", content: "Previous run" }],
        artifacts: ["old.md"],
        model: { provider: "copilot", name: "previous-model" },
      }),
      lastSeenEventId: 100,
    };
    client.setQueryData(queryKey, previous);
    const history = Promise.withResolvers<typeof previous>();
    const read = client.fetchQuery({ queryKey, queryFn: () => history.promise });

    applyWorkspaceEventToSessionQueries(client, { type: "session.deleted", sessionId });
    const empty = createInitialSessionState();
    expect(client.getQueryData<SessionState>(queryKey)).toEqual(empty);

    history.resolve(previous);
    await read.catch(() => {});
    expect(client.getQueryData<SessionState>(queryKey)).toEqual(empty);
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
