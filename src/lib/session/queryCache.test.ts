import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries, type SessionsState } from "@/lib/queries";
import {
  addSessionIfMissing,
  applyWorkspaceEventToSessionQueries,
  removeSessionFromState,
  restoreSessionsState,
  snapshotSessionsState,
  upsertSessionInState,
} from "./queryCache";
import type { SessionMetadata } from "@/types";

function createSession(sessionId: string): SessionMetadata {
  return {
    sessionId,
    startTime: new Date("2026-02-14T00:00:00.000Z"),
    modifiedTime: new Date("2026-02-14T01:00:00.000Z"),
    summary: "Existing session",
    isRemote: false,
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
  test("draft upsert prepends durable session metadata once", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-created-draft";

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        startTime: new Date(100).toISOString(),
        modifiedTime: new Date(200).toISOString(),
      },
    });
    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        startTime: new Date(100).toISOString(),
        modifiedTime: new Date(200).toISOString(),
      },
    });

    const state = readState(queryClient);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      sessionId,
      startTime: new Date(100),
      modifiedTime: new Date(200),
      summary: "",
      isRemote: false,
    });
  });

  test("upsert inserts or updates durable session metadata and side facts", () => {
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
        summary: "Updated",
        parentSessionId: "parent",
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
      summary: "Updated",
      modifiedTime: new Date("2026-02-14T02:00:00.000Z"),
    });
    expect(state.workerSessionIds).toEqual([sessionId]);
    expect(state.worktrees[sessionId]).toMatchObject({ branch: "feature" });
  });

  test("upsert preserves summary when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-summary-preserved";
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
    expect(state.sessions[0]?.summary).toBe("Existing session");
  });

  test("upsert preserves modified time when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-modified-preserved";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    applyWorkspaceEventToSessionQueries(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        summary: "Renamed session",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions[0]).toMatchObject({
      summary: "Renamed session",
      modifiedTime: new Date("2026-02-14T01:00:00.000Z"),
    });
  });

  test("delete removes durable session-side structures", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-delete";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
      workerSessionIds: [sessionId],
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
    expect(state.workerSessionIds).toEqual([]);
    expect(state.worktrees).toEqual({});
  });

  test("automation insertion adds a missing session without replacing existing metadata", () => {
    const queryClient = new QueryClient();
    const existing = createSession("automation-session");
    seedState(queryClient, { sessions: [existing] });

    addSessionIfMissing(queryClient, {
      ...existing,
      summary: "Replacement",
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
      summary: "Optimistic rename",
    });
    expect(readState(queryClient).sessions[0]?.summary).toBe("Optimistic rename");

    restoreSessionsState(queryClient, previousState);
    expect(readState(queryClient)).toEqual(previousState);
  });
});
