import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries, type SessionsState } from "@/lib/queries";
import { syncSessionQueriesFromWorkspaceEvent, getSessionsState } from "./queryCache";
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

describe("session query cache", () => {
  test("draft upsert prepends durable session metadata once", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-created-draft";

    syncSessionQueriesFromWorkspaceEvent(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        startTime: new Date(100).toISOString(),
        modifiedTime: new Date(200).toISOString(),
      },
    });
    syncSessionQueriesFromWorkspaceEvent(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        startTime: new Date(100).toISOString(),
        modifiedTime: new Date(200).toISOString(),
      },
    });

    const state = getSessionsState(queryClient);
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

    syncSessionQueriesFromWorkspaceEvent(queryClient, {
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

    const state = getSessionsState(queryClient);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      sessionId,
      summary: "Updated",
      modifiedTime: new Date("2026-02-14T02:00:00.000Z"),
    });
    expect(state.childSessionIds).toEqual([sessionId]);
    expect(state.worktrees[sessionId]).toMatchObject({ branch: "feature" });
  });

  test("upsert preserves summary when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-summary-preserved";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    syncSessionQueriesFromWorkspaceEvent(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        modifiedTime: "2026-02-14T02:00:00.000Z",
      },
    });

    const state = getSessionsState(queryClient);
    expect(state.sessions[0]?.summary).toBe("Existing session");
  });

  test("upsert preserves modified time when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-modified-preserved";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    syncSessionQueriesFromWorkspaceEvent(queryClient, {
      type: "session.upserted",
      session: {
        sessionId,
        summary: "Renamed session",
      },
    });

    const state = getSessionsState(queryClient);
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
      childSessionIds: [sessionId],
      worktrees: {
        [sessionId]: {
          branch: "feature",
          baseBranch: "main",
          path: "/tmp/worktree",
        },
      },
    });

    syncSessionQueriesFromWorkspaceEvent(queryClient, {
      type: "session.deleted",
      sessionId,
    });

    const state = getSessionsState(queryClient);
    expect(state.sessions).toEqual([]);
    expect(state.childSessionIds).toEqual([]);
    expect(state.worktrees).toEqual({});
  });
});
