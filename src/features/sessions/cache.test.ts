import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Session, SessionState } from "./model";
import { applySessionEvent, createInitialSessionState } from "./model/reducer";
import type { SessionsState } from "./model";
import type { SessionsActivity } from "./model/activity";
import {
  createEmptySessionsState,
  selectNonWorkerSessions,
  sessionActivityJournal,
  sessionQueries,
} from "./queries";
import cache, {
  invalidateSessionsStateQuery,
  recreateSessionInCache,
  snapshotSessionsState,
} from "./cache";

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
      expect(client.getQueryState(sessionQueries.stateKey())?.isInvalidated).toBe(false);

      cache.applyEvent(client, {
        type: `session.${status}`,
        sessionId: "older",
        at: 1,
      });
      expect(client.getQueryState(sessionQueries.stateKey())?.isInvalidated).toBe(true);
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

  test("a catalog refresh that later deletions replace settles quietly", async () => {
    const queryClient = new QueryClient();
    const sessionId = "toy-box-pinned";
    seedState(queryClient, { sessions: [createSession(sessionId)] });
    const observer = new QueryObserver(queryClient, {
      ...sessionQueries.state(),
      queryFn: () => Bun.sleep(5).then(() => createEmptySessionsState()),
    });
    onTestFinished(observer.subscribe(() => {}));

    // Deleting a pinned session refreshes the catalog for the pin change, then applies its
    // deletion locally and again when the server echoes it, each replacing the read in flight.
    const refresh = invalidateSessionsStateQuery(queryClient);
    cache.applyEvent(queryClient, { type: "session.deleted", sessionId });
    await Bun.sleep(1);
    cache.applyEvent(queryClient, { type: "session.deleted", sessionId });

    expect(await refresh).toBeUndefined();
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

    expect(queryClient.getQueryState(sessionQueries.stateKey())?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(sessionId).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(sessionQueries.detail(otherSessionId).queryKey)?.isInvalidated,
    ).toBe(false);
  });

  test("a refresh in flight when a session is read cannot bring its unread dot back", async () => {
    const queryClient = new QueryClient();
    onTestFinished(() => queryClient.clear());
    queryClient.setQueryData<SessionsActivity>(sessionQueries.activityKey(), {
      a: { status: "unread" },
    });
    const snapshot = Promise.withResolvers<SessionsActivity>();
    const refresh = queryClient.fetchQuery({
      ...sessionQueries.activity(),
      queryFn: ({ client }) => sessionActivityJournal.read(client, () => snapshot.promise),
      staleTime: 0,
    });

    cache.applyEvent(queryClient, { type: "session.read", sessionId: "a" });
    snapshot.resolve({ a: { status: "unread" } });

    expect(await refresh).toEqual({});
    expect(queryClient.getQueryData(sessionQueries.activityKey())).toEqual({});
  });
});

describe("session replacement and deletion cache boundary", () => {
  test("optimistic recreation replaces execution state and cancels older reads", async () => {
    const client = new QueryClient();
    const sessionId = "recreated-session";
    const queryKey = sessionQueries.detail(sessionId).queryKey;
    const otherSession = createSession("other-session");
    seedState(client, {
      sessions: [
        {
          ...createSession(sessionId),
          provider: { id: "copilot", sessionId: "previous-native-id" },
          context: { directory: "/previous" },
          artifactPath: "old.md",
        },
        otherSession,
      ],
      ownership: { [sessionId]: { type: "worker", parentSessionId: "previous-parent" } },
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
      lastSeenEventId: 100,
    };
    client.setQueryData(queryKey, previous);
    const catalog = Promise.withResolvers<SessionsState>();
    const history = Promise.withResolvers<SessionState>();
    const oldCatalog = readState(client);
    const reads = Promise.allSettled([
      client.fetchQuery({ queryKey: sessionQueries.stateKey(), queryFn: () => catalog.promise }),
      client.fetchQuery({ queryKey, queryFn: () => history.promise }),
    ]);
    const message = {
      clientId: "first-message",
      content: "Start fresh",
      model: { provider: "codex", name: "new-model" },
    };

    await recreateSessionInCache(client, sessionId, message, {
      title: "Replacement",
      sessionType: "standard",
    });
    const replacement = readState(client);
    expect(replacement).toEqual({
      sessions: [
        {
          id: sessionId,
          title: "Replacement",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        otherSession,
      ],
      ownership: {},
      worktrees: {},
    });
    const optimistic = client.getQueryData<SessionState>(queryKey)!;
    expect(optimistic).toMatchObject({
      model: message.model,
      status: "thinking",
      artifacts: [],
    });
    expect(optimistic.messages).toEqual([
      expect.objectContaining({
        role: "user",
        clientId: message.clientId,
        content: message.content,
      }),
    ]);
    expect(optimistic.lastSeenEventId).toBeUndefined();

    catalog.resolve(oldCatalog);
    history.resolve(previous);
    await reads;
    expect(readState(client)).toEqual(replacement);
    expect(client.getQueryData<SessionState>(queryKey)).toEqual(optimistic);
    client.clear();
  });

  test("the server acknowledges an optimistic draft and replaces its starting message by client ID", async () => {
    const client = new QueryClient();
    const sessionId = "new-session";
    const queryKey = sessionQueries.detail(sessionId).queryKey;
    await recreateSessionInCache(client, sessionId, {
      clientId: "first-message",
      content: "Cached prompt",
    });
    cache.applyEvent(client, {
      type: "session.upserted",
      session: {
        id: sessionId,
        createdAt: "2026-10-01T00:00:00.000Z",
        sessionType: "standard",
      },
    });
    const acknowledged = client.getQueryData<SessionState>(queryKey)!;
    expect(acknowledged.messages).toEqual([
      expect.objectContaining({ clientId: "first-message", content: "Cached prompt" }),
    ]);
    const streamed = applySessionEvent(acknowledged, {
      type: "user_message",
      clientId: "first-message",
      content: "Authoritative prompt",
    });
    expect(streamed.messages).toHaveLength(1);
    expect(streamed.messages[0]).toMatchObject({ content: "Authoritative prompt" });
    client.clear();
  });

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
      lastSeenEventId: 100,
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
    expect(retired.lastSeenEventId).toBeUndefined();
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
    test("owner events do not seed an incomplete session catalog", () => {
      const client = new QueryClient();
      onTestFinished(() => client.clear());
      cache.applyEvent(client, {
        type: "automation.upserted",
        automation,
      });
      expect(snapshotSessionsState(client)).toBeUndefined();
    });

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

    test.each(["automation.upserted", "automation.deleted"] as const)(
      "%s replaces an older catalog read without losing unrelated sessions",
      async (type) => {
        const client = new QueryClient();
        onTestFinished(() => client.clear());
        const stale = {
          ...createEmptySessionsState(),
          sessions: [createSession(automation.id)],
          ownership: {},
        };
        seedState(client, stale);
        const latest: SessionsState = {
          ...createEmptySessionsState(),
          sessions:
            type === "automation.upserted"
              ? [...stale.sessions, createSession("other")]
              : [createSession("other")],
          ownership: type === "automation.upserted" ? { automation: { type: "automation" } } : {},
        };
        const snapshot = Promise.withResolvers<SessionsState>();
        let reads = 0;
        const pending = client.fetchQuery({
          ...sessionQueries.state(),
          staleTime: 0,
          queryFn: () => (++reads === 1 ? snapshot.promise : Promise.resolve(latest)),
        });
        cache.applyEvent(
          client,
          type === "automation.upserted"
            ? { type, automation }
            : { type, automationId: automation.id },
        );
        snapshot.resolve(stale);
        await expect(pending).resolves.toEqual(latest);
        expect(reads).toBe(2);
        expect(readState(client)).toEqual(latest);
      },
    );

    test("Inbox results and unchanged Automation ownership do not replace a catalog read", async () => {
      const client = new QueryClient();
      onTestFinished(() => client.clear());
      seedState(client, { ownership: { automation: { type: "automation" } } });
      const state = readState(client);
      const snapshot = Promise.withResolvers<SessionsState>();
      let reads = 0;
      const pending = client.fetchQuery({
        ...sessionQueries.state(),
        staleTime: 0,
        queryFn: () => {
          reads++;
          return snapshot.promise;
        },
      });
      cache.applyEvent(client, {
        type: "automation.upserted",
        automation: { ...automation, nextRunAt: new Date(2).toISOString() },
      });
      cache.applyEvent(client, {
        type: "inbox.changed",
      });
      cache.applyEvent(client, {
        type: "inbox.entry.deleted",
        entryId: "inbox-worker",
      });
      expect(readState(client)).toBe(state);
      snapshot.resolve(state);
      await pending;
      expect(reads).toBe(1);
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
