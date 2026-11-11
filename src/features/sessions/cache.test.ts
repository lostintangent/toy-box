import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Session, SessionState } from "./model";
import { createInitialSessionState } from "./model/reducer";
import type { SessionsState } from "./model";
import { createEmptySessionsState, selectNonWorkerSessions, sessionQueries } from "./queries";
import cache, { repairFailedDraft } from "./cache";

function createSession(sessionId: string): Session {
  return {
    id: sessionId,
    createdAt: new Date("2026-02-14T00:00:00.000Z"),
    updatedAt: new Date("2026-02-14T01:00:00.000Z"),
    title: "Existing session",
  };
}

function seedState(queryClient: QueryClient, state: Partial<SessionsState>): void {
  queryClient.setQueryData(sessionQueries.state.queryKey, {
    ...createEmptySessionsState(),
    ...state,
  });
}

/** Watches a session's detail, recording each observation Query starts without settling it. */
function watchDetail(queryClient: QueryClient, sessionId: string) {
  const observations: Array<ReturnType<typeof Promise.withResolvers<SessionState>>> = [];
  const observe = () => {
    observations.push(Promise.withResolvers<SessionState>());
    return observations.at(-1)!.promise;
  };
  const watcher = new QueryObserver(queryClient, {
    queryKey: sessionQueries.detail(sessionId).queryKey,
    queryFn: observe,
  });
  onTestFinished(watcher.subscribe(() => {}));
  return observations;
}

function readState(queryClient: QueryClient): SessionsState {
  return queryClient.getQueryData(sessionQueries.state.queryKey) ?? createEmptySessionsState();
}

describe("session query cache", () => {
  test("first-turn promotion and renaming retain the session's identity and initial artifact", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-upserted-session";
    seedState(queryClient, {});

    cache.applyEvent(queryClient, {
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
    cache.applyEvent(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        provider: { id: "codex" },
        updatedAt: new Date(200).toISOString(),
        context: { directory: "/repo" },
      },
    });
    cache.applyEvent(queryClient, {
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

    cache.applyEvent(queryClient, {
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
    expect(state.ownership).toEqual({ [sessionId]: { type: "worker", parentSessionId: "parent" } });
    expect(state.worktrees[sessionId]).toMatchObject({ branch: "feature" });
  });

  test("retains Channel worker metadata without projecting it as an ordinary session", () => {
    const queryClient = new QueryClient();
    seedState(queryClient, {});

    cache.applyEvent(queryClient, {
      type: "session.upserted",
      session: {
        id: "channel-worker-session",
        sessionType: "worker",
        worktree: { branch: "agent", baseBranch: "main", path: "/tmp/agent" },
      },
    });

    const state = readState(queryClient);
    expect(state.ownership).toEqual({
      "channel-worker-session": { type: "worker", parentSessionId: null },
    });
    expect(state.worktrees).toHaveProperty("channel-worker-session");
    expect(selectNonWorkerSessions(state)).toEqual([]);
  });

  test("does not synthesize a missing session from an unclassified metadata patch", () => {
    const queryClient = new QueryClient();
    seedState(queryClient, {});

    cache.applyEvent(queryClient, {
      type: "session.upserted",
      session: {
        id: "unprojected-session",
        title: "Partial update",
      },
    });

    expect(readState(queryClient)).toEqual(createEmptySessionsState());
  });

  test("upsert preserves title when omitted", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-title-preserved";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
    });

    cache.applyEvent(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        updatedAt: "2026-02-14T02:00:00.000Z",
      },
    });

    const state = readState(queryClient);
    expect(state.sessions[0]?.title).toBe("Existing session");
  });

  test.each(["running", "waiting", "unread"] as const)(
    "%s activity refreshes an omitted session without refetching known sessions",
    (status) => {
      const client = new QueryClient();
      seedState(client, { sessions: [createSession("recent")] });

      cache.applyEvent(client, {
        type: `session.${status}`,
        sessionId: "recent",
        at: 1,
      });
      expect(client.getQueryState(sessionQueries.state.queryKey)?.isInvalidated).toBe(false);

      cache.applyEvent(client, {
        type: `session.${status}`,
        sessionId: "older",
        at: 1,
      });
      expect(client.getQueryState(sessionQueries.state.queryKey)?.isInvalidated).toBe(true);
      client.clear();
    },
  );

  test("delete removes durable session-side structures", () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-delete";
    seedState(queryClient, {
      sessions: [createSession(sessionId)],
      ownership: { [sessionId]: { type: "worker", parentSessionId: "parent" } },
      worktrees: {
        [sessionId]: {
          branch: "feature",
          baseBranch: "main",
          path: "/tmp/worktree",
        },
      },
    });

    cache.applyEvent(queryClient, {
      type: "session.deleted",
      sessionId: sessionId,
    });

    const state = readState(queryClient);
    expect(state.sessions).toEqual([]);
    expect(state.ownership).toEqual({});
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
    cache.applyEvent(queryClient, {
      type: "session.touched",
      sessionId: sessionId,
    });

    expect(queryClient.getQueryState(sessionQueries.state.queryKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(sessionId).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(otherSessionId).queryKey)?.isInvalidated,
    ).toBe(false);
  });

  test("activity and refreshes resume a watched detail's ended observation, never a running one", async () => {
    const queryClient = new QueryClient();
    onTestFinished(() => queryClient.clear());
    const sessionId = "observed";
    seedState(queryClient, { sessions: [createSession(sessionId)] });
    const observations = watchDetail(queryClient, sessionId);

    cache.applyEvent(queryClient, { type: "session.running", sessionId, at: 1 });
    await cache.refresh(queryClient);
    expect(observations).toHaveLength(1);

    observations[0]!.resolve(createInitialSessionState());
    await Bun.sleep(0);
    cache.applyEvent(queryClient, { type: "session.unread", sessionId });
    expect(observations).toHaveLength(2);

    observations[1]!.resolve(createInitialSessionState());
    await Bun.sleep(0);
    void cache.refresh(queryClient);
    expect(observations).toHaveLength(3);
  });

  test("a failed draft send resumes the observation only of a session the server created", async () => {
    const queryClient = new QueryClient();
    onTestFinished(() => queryClient.clear());
    const sessionId = "draft";
    // The pane still watches the draft its optimistic send promoted until it renders the repair.
    seedState(queryClient, { sessions: [createSession(sessionId)] });
    const observations = watchDetail(queryClient, sessionId);

    await repairFailedDraft(queryClient, sessionId);
    expect(observations).toHaveLength(1);

    seedState(queryClient, {
      sessions: [{ ...createSession(sessionId), provider: { id: "copilot" } }],
    });
    await repairFailedDraft(queryClient, sessionId);
    expect(observations).toHaveLength(2);
  });
});

describe("session replacement and deletion cache boundary", () => {
  test("a replacement upsert retires the previous transcript without removing the session", async () => {
    const client = new QueryClient();
    const sessionId = "automation";
    const queryKey = sessionQueries.detail(sessionId).queryKey;
    seedState(client, {
      sessions: [
        {
          ...createSession(sessionId),
          provider: { id: "copilot", sessionId: "previous-native-id" },
          context: { directory: "/previous" },
          artifactPath: "old.md",
        },
      ],
      ownership: { [sessionId]: { type: "automation" } },
      worktrees: {
        [sessionId]: { path: "/previous", branch: "old", baseBranch: "main" },
      },
    });
    const previous = {
      ...createInitialSessionState({
        messages: [{ role: "assistant", content: "Previous run" }],
        artifacts: [{ path: "old.md", updatedAt: 1 }],
        model: { provider: "copilot", name: "previous-model" },
      }),
      revision: 100,
    };
    client.setQueryData(queryKey, previous);
    const history = Promise.withResolvers<typeof previous>();
    const read = client.fetchQuery({ queryKey, queryFn: () => history.promise });

    cache.applyEvent(client, {
      type: "session.upserted",
      session: {
        id: sessionId,
        createdAt: "2026-02-15T00:00:00.000Z",
        updatedAt: "2026-02-15T00:00:00.000Z",
        title: "Replacement run",
        sessionType: "automation",
      },
    });
    const retired = client.getQueryData<SessionState>(queryKey)!;
    expect(retired.messages).toEqual([]);
    expect(retired.artifacts).toEqual([]);
    expect(retired.model).toBeUndefined();
    expect(retired.revision).toBe(0);
    expect(readState(client).sessions).toEqual([
      {
        id: sessionId,
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
        updatedAt: new Date("2026-02-15T00:00:00.000Z"),
        title: "Replacement run",
        provider: undefined,
        context: undefined,
        artifactPath: undefined,
      },
    ]);
    expect(readState(client).ownership).toEqual({ [sessionId]: { type: "automation" } });
    expect(readState(client).worktrees).toEqual({});

    history.resolve(previous);
    await read.catch(() => {});
    expect(client.getQueryData<SessionState>(queryKey)).toEqual(retired);
    client.clear();
  });

  describe("managed ownership cache", () => {
    const automation = {
      id: "automation",
      title: "Scheduled work",
      prompt: "Run",
      cron: "0 9 * * *",
      model: { provider: "copilot", name: "gpt-5" },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      nextRunAt: new Date(1).toISOString(),
    };
    test("ownership precedes the session and survives metadata changes and backing-session deletion", () => {
      const client = new QueryClient();
      onTestFinished(() => client.clear());
      seedState(client, {});
      const event = {
        type: "automation.upserted",
        automation,
      } as const;
      cache.applyEvent(client, event);
      const owned = readState(client);
      cache.applyEvent(client, event);
      expect(readState(client)).toBe(owned);
      expect(owned.sessions).toEqual([]);
      expect(owned.ownership).toEqual({ automation: { type: "automation" } });
      cache.applyEvent(client, {
        type: "session.upserted",
        session: { id: automation.id, sessionType: "automation" },
      });
      cache.applyEvent(client, {
        type: "session.upserted",
        session: { id: automation.id, title: "Completed work" },
      });
      cache.applyEvent(client, {
        type: "session.deleted",
        sessionId: automation.id,
      });
      expect(readState(client)).toEqual(owned);
      cache.applyEvent(client, {
        type: "automation.deleted",
        automationId: automation.id,
      });
      expect(readState(client)).toEqual(createEmptySessionsState());
    });
  });

  test("does not populate history caches for sessions this client has never opened", () => {
    const client = new QueryClient();
    cache.applyEvent(client, {
      type: "session.deleted",
      sessionId: "unopened",
    });
    expect(client.getQueryData(sessionQueries.detail("unopened").queryKey)).toBeUndefined();
    client.clear();
  });
});
