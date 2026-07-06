import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { deliverSessionMessage, SessionStream } from "./index";
import * as realSnapshotCache from "../../state/snapshotCache";
import * as realWorkspaceState from "../../state/workspace";
import * as realBroadcast from "../broadcast";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/historyReplay";
import { toSessionSnapshot } from "@/lib/session/sessionReducer";
import type { QueuedMessage, SessionEvent, SessionSnapshot } from "@/types";

const realSnapshotCacheExports = { ...realSnapshotCache };
const realWorkspaceStateExports = { ...realWorkspaceState };
const realBroadcastExports = { ...realBroadcast };

type SessionEvents = Awaited<ReturnType<CopilotSession["getEvents"]>>;

type MockWithSession = <T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
) => Promise<T>;

function userMessage(content: string, id: string = crypto.randomUUID()): QueuedMessage {
  return { id, role: "user", content };
}

function artifactEdit(path: string, id: string = crypto.randomUUID()): QueuedMessage {
  return { id, role: "agent_notification", notification: { type: "artifact_edited", path } };
}

async function nextStreamEvent(iterator: AsyncIterator<SessionEvent>): Promise<SessionEvent> {
  const result = await iterator.next();
  expect(result.done).toBe(false);
  return result.value!;
}

async function collectStreamEvents(
  iterator: AsyncIterator<SessionEvent>,
  limit = 20,
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for (let i = 0; i < limit; i++) {
    const result = await iterator.next();
    if (result.done) return events;
    events.push(result.value);
  }

  throw new Error("Stream iterator did not finish");
}

function withSessionEvents(events: SessionEvents): MockWithSession {
  return async (_sessionId, operation) =>
    operation({ getEvents: async () => events } as unknown as CopilotSession);
}

/** Mock the runtime modules SessionStream imports so tests can drive streams with
 *  fake SDK sessions. Callers override the sessionRegistry and snapshotCache
 *  behavior they need; the defaults fail loudly if an unexpected path is
 *  taken, and the default snapshot cache is always empty. */
function mockStreamRuntimeModules(
  sessionRegistryOverrides: Record<string, unknown> = {},
  snapshotCacheOverrides: Record<string, unknown> = {},
  broadcastOverrides: Record<string, unknown> = {},
) {
  const getCachedSnapshot =
    (snapshotCacheOverrides.getCachedSnapshot as
      | ((sessionId: string) => Promise<SessionSnapshot | undefined>)
      | undefined) ?? (async () => undefined);
  const cacheSnapshot =
    (snapshotCacheOverrides.cacheSnapshot as
      | ((sessionId: string, snapshot: SessionSnapshot) => void)
      | undefined) ?? (() => {});
  const loadSessionSnapshot =
    (snapshotCacheOverrides.loadSessionSnapshot as
      | ((sessionId: string) => Promise<SessionSnapshot>)
      | undefined) ??
    (async (sessionId: string) => {
      const cachedSnapshot = await getCachedSnapshot(sessionId);
      if (cachedSnapshot) return cachedSnapshot;

      const withSession = sessionRegistryOverrides.withSession as MockWithSession | undefined;
      if (!withSession) {
        throw new Error("withSession mock was not provided");
      }

      const events = await withSession(sessionId, (session) => session.getEvents());
      const snapshot = toSessionSnapshot(
        sessionId,
        await initializeSessionStateFromSdkHistory(sessionId, events),
      );
      cacheSnapshot(sessionId, snapshot);
      return snapshot;
    });

  mock.module("../../state/sessionRegistry", () => ({
    createSession: async () => {
      throw new Error("createSession mock was not provided");
    },
    getSession: async () => {
      throw new Error("getSession mock was not provided");
    },
    withSession: async () => {
      throw new Error("withSession mock was not provided");
    },
    evictCachedSessionIfStale: () => false,
    ...sessionRegistryOverrides,
  }));
  mock.module("../../state/snapshotCache", () => ({
    ...realSnapshotCacheExports,
    getCachedSnapshot,
    cacheSnapshot,
    evictCachedSnapshot: () => {},
    loadSessionSnapshot,
    ...snapshotCacheOverrides,
  }));
  onTestFinished(() => {
    mock.module("../../state/snapshotCache", () => realSnapshotCacheExports);
  });
  mock.module("../../state/workspace", () => ({
    ...realWorkspaceStateExports,
    markSessionRead: () => {},
    markSessionUnread: () => {},
  }));
  onTestFinished(() => {
    mock.module("../../state/workspace", () => realWorkspaceStateExports);
  });
  mock.module("../broadcast", () => ({
    ...realBroadcastExports,
    emitSessionRunning: () => {},
    emitSessionIdle: () => {},
    updateSessionName: () => {},
    emitDraftCreated: () => {},
    emitDraftDiscarded: () => {},
    emitSessionHyper: () => {},
    emitSessionPromoted: () => {},
    emitDraftPromptChanged: () => {},
    emitAutomationsUpdate: () => {},
    subscribeAutomationsUpdates: () => () => {},
    ...broadcastOverrides,
  }));
  onTestFinished(() => {
    mock.module("../broadcast", () => realBroadcastExports);
  });
}

describe("SessionStream lifecycle", () => {
  test("close clears the queue, signals end-of-stream, and deregisters", async () => {
    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-close-semantics", fakeSession);
    const events = stream.subscribe();

    await stream.startTurn(userMessage("go"));
    stream.addQueuedMessage(userMessage("queued"));
    stream.close();

    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "user_message",
      "message_queued",
      "end",
    ]);
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince()).toEqual([]);
    expect(SessionStream.isRunning("session-close-semantics")).toBe(false);
  });

  test("detach deregisters without signalling end-of-stream", async () => {
    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-detach-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("go"));
    expect(await nextStreamEvent(events)).toMatchObject({ type: "user_message" });

    let settled = false;
    const pending = events.next().then(() => {
      settled = true;
    });
    stream.detach();
    await Bun.sleep(1);

    expect(settled).toBe(false);
    expect(SessionStream.isRunning("session-detach-semantics")).toBe(false);
    // Replay history survives detach — the runtime object is cleaned up, not the turn.
    expect(stream.getReplayEventsSince().length).toBeGreaterThan(0);
    await events.return();
    await pending;
  });

  test("unsubscribing from an idle stream detaches it", async () => {
    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-idle-unsubscribe", fakeSession);
    const events = stream.subscribe();

    await events.return();

    expect(SessionStream.isRunning("session-idle-unsubscribe")).toBe(false);
  });

  test("remove publishes a terminal event without global lifecycle updates", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-remove-semantics");
    });

    const emitSessionIdleMock = mock((_sessionId: string) => {});
    mockStreamRuntimeModules({}, {}, { emitSessionIdle: emitSessionIdleMock });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = ImportedSessionStream.getOrCreate("session-remove-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("go"));
    stream.addQueuedMessage(userMessage("queued"));

    ImportedSessionStream.remove("session-remove-semantics");

    const emittedEvents = await collectStreamEvents(events);
    expect(emittedEvents.map((event) => event.type)).toEqual([
      "user_message",
      "message_queued",
      "end",
    ]);
    expect(emittedEvents.at(-1)).toMatchObject({ type: "end", reason: "idle" });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(ImportedSessionStream.isRunning("session-remove-semantics")).toBe(false);
    // Deleted sessions leave the list, so no idle/unread global broadcast events are emitted.
    expect(emitSessionIdleMock).toHaveBeenCalledTimes(0);
  });

  test("closed streams reject late queued-message mutations", async () => {
    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-closed-mutations", fakeSession);
    stream.close();

    expect(stream.addQueuedMessage(userMessage("late follow-up", "late"))).toBe(false);
    expect(stream.cancelQueuedMessage("late")).toBe(false);

    expect(stream.getQueuedMessages()).toEqual([]);
  });

  test("abort closes and deregisters even when the SDK abort fails", async () => {
    onTestFinished(() => {
      SessionStream.close("session-abort-failure");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
      abort: async () => {
        throw new Error("abort exploded");
      },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-abort-failure", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("go"));

    await expect(stream.abort()).rejects.toThrow("abort exploded");

    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "user_message",
      "end",
    ]);
    expect(SessionStream.isRunning("session-abort-failure")).toBe(false);
  });

  test("drains the queue on idle: dequeues, sends, then closes when empty", async () => {
    onTestFinished(() => {
      SessionStream.close("session-drain");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      send: sendMock,
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-drain", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("first turn"));
    stream.addQueuedMessage(userMessage("second turn", "q1"));

    // First idle: drains the queue into turn 2.
    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMock).toHaveBeenCalledWith({ prompt: "second turn", attachments: undefined });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince().map((event) => event.type)).toContain("message_dequeued");
    expect(SessionStream.isRunning("session-drain")).toBe(true);

    // Second idle with an empty queue: closes the stream.
    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await collectStreamEvents(events)).map((event) => event.type)).toContain(
      "message_dequeued",
    );
    expect(SessionStream.isRunning("session-drain")).toBe(false);
  });

  test("closes the stream when draining fails to send", async () => {
    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    let sendCount = 0;
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      // The first turn sends fine; the drained follow-up explodes.
      send: async () => {
        if (++sendCount > 1) throw new Error("send exploded");
      },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-drain-failure", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("first turn"));
    stream.addQueuedMessage(userMessage("doomed follow-up"));

    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const drained = await collectStreamEvents(events);
    expect(drained.map((event) => event.type)).toEqual([
      "user_message",
      "message_queued",
      "message_dequeued",
      "end",
    ]);
    expect(drained.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-drain-failure")).toBe(false);
  });

  test("emits an error end when the SDK terminates the stream with an error", async () => {
    onTestFinished(() => {
      SessionStream.close("session-sdk-error");
    });

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-sdk-error", fakeSession);
    const events = stream.subscribe();
    await stream.startTurn(userMessage("go"));

    sdkHandler!({ type: "session.error", data: {} });

    const emitted = await collectStreamEvents(events);
    expect(emitted.map((event) => event.type)).toEqual(["user_message", "end"]);
    expect(emitted.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-sdk-error")).toBe(false);
  });

  test("cancelQueuedMessage cancels known ids and rejects unknown ones", () => {
    onTestFinished(() => {
      SessionStream.close("session-queue-remove");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-queue-remove", fakeSession);
    stream.addQueuedMessage(userMessage("keep me", "q1"));
    stream.addQueuedMessage(userMessage("cancel me", "q2"));

    expect(stream.cancelQueuedMessage("missing")).toBe(false);
    expect(stream.cancelQueuedMessage("q2")).toBe(true);
    expect(stream.getQueuedMessages().map((m) => m.id)).toEqual(["q1"]);
  });
});

describe("queued-message coalescing", () => {
  test("collapses equivalent notifications and always queues normal prompts", async () => {
    onTestFinished(() => {
      SessionStream.close("session-coalesce");
    });

    const fakeSession = { on: () => () => {} } as unknown as CopilotSession;
    const stream = SessionStream.getOrCreate("session-coalesce", fakeSession);

    // Editing the same artifact twice collapses to a single nudge.
    const planEdited = artifactEdit("plan.md", "plan-edit");
    await deliverSessionMessage({ sessionId: "session-coalesce", message: planEdited });
    await deliverSessionMessage({ sessionId: "session-coalesce", message: planEdited });
    expect(stream.getQueuedMessages()).toHaveLength(1);

    // A different artifact is its own notification.
    await deliverSessionMessage({
      sessionId: "session-coalesce",
      message: artifactEdit("other.md", "other-edit"),
    });
    expect(stream.getQueuedMessages()).toHaveLength(2);

    // Normal prompts never coalesce.
    await deliverSessionMessage({
      sessionId: "session-coalesce",
      message: userMessage("hello", "hello-1"),
    });
    await deliverSessionMessage({
      sessionId: "session-coalesce",
      message: userMessage("hello", "hello-2"),
    });
    expect(stream.getQueuedMessages()).toHaveLength(4);
  });

  test("coalescing guards every queue door, including direct addQueuedMessage", () => {
    onTestFinished(() => {
      SessionStream.close("session-coalesce-direct");
    });

    const fakeSession = { on: () => () => {} } as unknown as CopilotSession;
    const stream = SessionStream.getOrCreate("session-coalesce-direct", fakeSession);

    stream.addQueuedMessage(artifactEdit("plan.md", "edit-1"));
    stream.addQueuedMessage(artifactEdit("plan.md", "edit-2"));
    stream.addQueuedMessage(userMessage("hello", "u1"));
    stream.addQueuedMessage(userMessage("hello", "u2"));

    expect(stream.getQueuedMessages().map((message) => message.id)).toEqual(["edit-1", "u1", "u2"]);
  });
});

describe("SessionStream event replay", () => {
  test("getReplayEventsSince filters by cursor and returns a defensive copy", async () => {
    onTestFinished(() => {
      SessionStream.close("session-buffer-since");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-buffer-since", fakeSession);
    await stream.startTurn(userMessage("go"));
    stream.addQueuedMessage(userMessage("one", "q1"));
    stream.addQueuedMessage(userMessage("two", "q2"));

    const all = stream.getReplayEventsSince();
    expect(all.map((e) => e.type)).toEqual(["user_message", "message_queued", "message_queued"]);

    const afterFirst = stream.getReplayEventsSince(all[0].eventId);
    expect(afterFirst.map((e) => e.type)).toEqual(["message_queued", "message_queued"]);

    // Mutating the returned array must not affect the internal buffer.
    all.length = 0;
    expect(stream.getReplayEventsSince().length).toBe(3);
  });

  test("caps replay history at the retention limit, keeping the newest events", () => {
    onTestFinished(() => {
      SessionStream.close("session-buffer-cap");
    });

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-buffer-cap", fakeSession);
    for (let i = 0; i < 1600; i++) {
      sdkHandler!({ type: "assistant.message_delta", data: { deltaContent: `chunk-${i} ` } });
    }

    const replay = stream.getReplayEventsSince();
    expect(replay.length).toBe(1500);
    expect(replay.at(-1)).toMatchObject({ type: "delta", content: "chunk-1599 " });
    expect(replay[0]).toMatchObject({ type: "delta", content: "chunk-100 " });
  });
});

describe("SessionStream event IDs", () => {
  test("increase across consecutive stream instances for the same session", async () => {
    onTestFinished(() => {
      SessionStream.close("session-event-id-reuse");
    });

    const makeFakeSession = () =>
      ({
        on: () => () => {},
        send: async () => {},
      }) as unknown as CopilotSession;

    const first = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    await first.startTurn(userMessage("First run"));
    const firstEventId = first.getReplayEventsSince()[0]?.eventId;
    first.detach();

    const second = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    await second.startTurn(userMessage("Second run"));
    const secondEventId = second.getReplayEventsSince()[0]?.eventId;

    expect(firstEventId).toEqual(expect.any(Number));
    expect(secondEventId).toEqual(expect.any(Number));
    expect(secondEventId!).toBeGreaterThan(firstEventId!);
  });

  test("do not regress after a synchronous burst faster than 1 event/ms", async () => {
    onTestFinished(() => {
      SessionStream.close("session-event-id-burst");
    });

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const makeFakeSession = () =>
      ({
        on: (handler: (event: { type: string; data: unknown }) => void) => {
          sdkHandler = handler;
          return () => {};
        },
        send: async () => {},
      }) as unknown as CopilotSession;

    // A synchronous burst mints ids faster than wall time advances, pushing
    // the last issued id well past Date.now().
    const first = SessionStream.getOrCreate("session-event-id-burst", makeFakeSession());
    await first.startTurn(userMessage("burst"));
    for (let i = 0; i < 2000; i++) {
      sdkHandler!({ type: "assistant.message_delta", data: { deltaContent: `chunk-${i} ` } });
    }
    const lastBurstEventId = first.getReplayEventsSince().at(-1)!.eventId!;
    first.detach();

    // A replacement stream for the same session must keep ids increasing, or
    // the client's lastSeenEventId filter would silently drop its events.
    const second = SessionStream.getOrCreate("session-event-id-burst", makeFakeSession());
    await second.startTurn(userMessage("after burst"));

    expect(second.getReplayEventsSince()[0]!.eventId!).toBeGreaterThan(lastBurstEventId);
  });
});

describe("SessionStream model configuration", () => {
  test("turn model configuration emits a model_changed event into live stream state", async () => {
    onTestFinished(() => {
      SessionStream.close("session-model-change");
    });

    const setModelMock = mock(
      async (_model: string, _options?: { reasoningEffort?: string }) => {},
    );
    const fakeSession = {
      on: () => () => {},
      setModel: setModelMock,
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-model-change", fakeSession);
    const events = stream.subscribe();

    await stream.startTurn({
      id: "model-turn",
      role: "user",
      content: "Use this model",
      modelConfiguration: { model: "gpt-5.5", reasoningEffort: "high" },
    });

    expect(setModelMock).toHaveBeenCalledWith("gpt-5.5", { reasoningEffort: "high" });
    expect(stream.getSessionState().modelConfiguration).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({ type: "user_message" }),
    );
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({
        type: "model_changed",
        modelConfiguration: { model: "gpt-5.5", reasoningEffort: "high" },
      }),
    );
    await events.return();
  });
});

describe("connectClientStream", () => {
  test("reuses the active stream for reconnects without replaying SDK history", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-reconnect");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, connectClientStream: importedConnectStream } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-reconnect", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    await stream.startTurn(userMessage("Reconnect me"));

    const iterator = importedConnectStream({ sessionId: "session-reconnect" });
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Reconnect me",
    });
  });

  test("treats stale draft-start requests as reconnects to the existing turn", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-draft-race");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      send: sendMock,
      on: () => () => {},
    } as unknown as CopilotSession;

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, connectClientStream: importedConnectStream } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-draft-race", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    await stream.startTurn(userMessage("Original draft prompt", "client-1"));
    const onDelivered = mock(() => {});

    const iterator = importedConnectStream({
      sessionId: "session-draft-race",
      prompt: "Original draft prompt",
      startNew: true,
      onDelivered,
    });
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Original draft prompt",
      clientMessageId: "client-1",
    });
    expect(stream.getQueuedMessages()).toEqual([]);
    // Only the original turn's send — the stale retry must not send again.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(onDelivered).not.toHaveBeenCalled();
  });

  test("fires onDelivered when a client prompt queues onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-client-delivered-queue");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;
    const onDelivered = mock(() => {});

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, connectClientStream: importedConnectStream } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-client-delivered-queue", fakeSession);
    await stream.startTurn(userMessage("Already running"));

    const result = await importedConnectStream({
      sessionId: "session-client-delivered-queue",
      prompt: "Queue this client prompt",
      onDelivered,
    }).next();

    expect(result).toEqual({ done: true, value: undefined });
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({ content: "Queue this client prompt" }),
    ]);
  });

  test("fires onDelivered when a client prompt starts a new stream turn", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-client-delivered-start");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      on: () => () => {},
      send: sendMock,
    } as unknown as CopilotSession;
    const onDelivered = mock(() => {});

    mockStreamRuntimeModules({
      createSession: async () => fakeSession,
    });

    const { connectClientStream: importedConnectStream } = await import("./index");

    const iterator = importedConnectStream({
      sessionId: "session-client-delivered-start",
      prompt: "Start this client prompt",
      startNew: true,
      onDelivered,
    });
    const first = await iterator.next();
    await Bun.sleep(0);
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Start this client prompt",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  test("retries a client follow-up if the active stream closes before queueing", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-client-queue-retry");
    });

    const activeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const sendMock = mock(async (_message: { prompt: string }) => {
      sdkHandler!({ type: "assistant.turn_start", data: {} });
      sdkHandler!({ type: "assistant.message", data: { content: "retried response" } });
      sdkHandler!({ type: "session.idle", data: {} });
    });
    const resumedSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      send: sendMock,
    } as unknown as CopilotSession;

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => resumedSession,
    });

    const { SessionStream: ImportedSessionStream, connectClientStream: importedConnectStream } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-client-queue-retry", activeSession);
    await stream.startTurn(userMessage("Already running"));

    const originalAddQueuedMessage = stream.addQueuedMessage.bind(stream);
    let closedBeforeQueue = false;
    stream.addQueuedMessage = ((message: QueuedMessage) => {
      if (!closedBeforeQueue) {
        closedBeforeQueue = true;
        stream.close();
        return false;
      }

      return originalAddQueuedMessage(message);
    }) as typeof stream.addQueuedMessage;

    const events = await collectStreamEvents(
      importedConnectStream({
        sessionId: "session-client-queue-retry",
        prompt: "Follow-up after close",
      }),
    );

    expect(closedBeforeQueue).toBe(true);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Follow-up after close",
      attachments: undefined,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "user_message", content: "Follow-up after close" }),
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({ type: "assistant_message", content: "retried response" }),
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
  });

  test("subscribes before sending so short committed responses are delivered", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-short-response");
    });

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const sendMock = mock(async (_message: { prompt: string }) => {
      sdkHandler!({ type: "assistant.turn_start", data: {} });
      sdkHandler!({
        type: "assistant.message",
        data: { content: "France's capital is Paris." },
      });
      sdkHandler!({ type: "session.idle", data: {} });
    });
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      send: sendMock,
    } as unknown as CopilotSession;

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { connectClientStream: importedConnectStream } = await import("./index");

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of importedConnectStream({
      sessionId: "session-short-response",
      prompt: "What is France's capital?",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: "user_message", content: "What is France's capital?" }),
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({
        type: "assistant_message",
        content: "France's capital is Paris.",
      }),
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "What is France's capital?",
      attachments: undefined,
    });
  });

  test("emits an error end when the first send fails before the first pull", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-first-send-failure");
    });

    const evictMock = mock((_sessionId: string, _error: unknown) => false);
    const fakeSession = {
      on: () => () => {},
      send: async () => {
        throw new Error("send exploded");
      },
    } as unknown as CopilotSession;

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
      evictCachedSessionIfStale: evictMock,
    });

    const { SessionStream: ImportedSessionStream, connectClientStream: importedConnectStream } =
      await import("./index");

    const iterator = importedConnectStream({
      sessionId: "session-first-send-failure",
      prompt: "doomed prompt",
    });

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "user_message", content: "doomed prompt" });

    const second = await iterator.next();
    expect(second.value).toMatchObject({ type: "end", reason: "error" });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(ImportedSessionStream.isRunning("session-first-send-failure")).toBe(false);
    expect(evictMock).toHaveBeenCalledTimes(1);
  });
});

describe("delivery receipts", () => {
  test("returns a queued receipt when the target stream is already live", async () => {
    onTestFinished(() => {
      SessionStream.close("session-delivery-queued");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-delivery-queued", fakeSession);
    await stream.startTurn(userMessage("Already running"));

    const receipt = await deliverSessionMessage({
      sessionId: "session-delivery-queued",
      message: userMessage("Queue through delivery"),
    });

    expect(receipt).toMatchObject({
      sessionId: "session-delivery-queued",
      disposition: "queued",
    });
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({ content: "Queue through delivery" }),
    ]);

    const completion = receipt.completion();
    stream.close();
    await expect(completion).resolves.toEqual({});
  });

  test("returns a sent receipt when delivery opens an idle session turn", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-delivery-sent");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      send: sendMock,
      on: () => () => {},
    } as unknown as CopilotSession;

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    const receipt = await importedDeliver({
      sessionId: "session-delivery-sent",
      message: userMessage("Start through delivery"),
    });

    expect(receipt).toMatchObject({
      sessionId: "session-delivery-sent",
      disposition: "sent",
    });
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start through delivery",
      attachments: undefined,
    });

    const completion = receipt.completion();
    ImportedSessionStream.close("session-delivery-sent");
    await expect(completion).resolves.toEqual({});
  });
});

describe("deliverSessionMessage delivery paths", () => {
  test("queues prompts onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-queue-helper");
    });

    const fakeSession = {
      on: () => () => {},
      send: async () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-queue-helper", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    await stream.startTurn(userMessage("Already running"));

    const { deliverSessionMessage: importedDeliver } = await import("./index");

    await importedDeliver({
      sessionId: "session-queue-helper",
      message: userMessage("Queue this follow-up"),
    });

    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Queue this follow-up",
      }),
    ]);
  });

  test("starts an idle historical session immediately", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-start-helper");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      send: sendMock,
      on: () => () => {},
    } as unknown as CopilotSession;

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver({
      sessionId: "session-start-helper",
      message: {
        id: "start-helper",
        role: "user",
        content: "Start this session again",
        attachments: [
          {
            displayName: "image.png",
            base64: "aW1hZ2U=",
            mimeType: "image/png",
          },
        ],
      },
    });

    expect(ImportedSessionStream.get("session-start-helper")).toBeDefined();
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start this session again",
      attachments: [
        {
          type: "blob",
          displayName: "image.png",
          data: "aW1hZ2U=",
          mimeType: "image/png",
        },
      ],
    });
  });

  test("seeds a resumed stream from a cached snapshot without fetching history", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-snapshot-seed");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      send: sendMock,
      on: () => () => {},
    } as unknown as CopilotSession;

    mockStreamRuntimeModules(
      {
        withSession: async () => {
          throw new Error("snapshot-seeded streams must not fetch history");
        },
        getSession: async () => fakeSession,
      },
      {
        getCachedSnapshot: async () => ({
          id: "session-snapshot-seed",
          messages: [
            { role: "user", content: "earlier prompt" },
            { role: "assistant", content: "earlier answer" },
          ],
          queuedMessages: [],
          status: "idle",
          reasoningContent: "",
        }),
      },
    );

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver({
      sessionId: "session-snapshot-seed",
      message: userMessage("follow-up question"),
    });

    const stream = ImportedSessionStream.get("session-snapshot-seed");
    expect(stream).toBeDefined();
    expect(
      stream!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer", "follow-up question"]);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "follow-up question",
      attachments: undefined,
    });
  });

  test("retries once when a snapshot-seeded send hits a stale cached handle", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-snapshot-stale");
    });

    const staleSend = mock(async () => {
      throw new Error("Session not found: session-snapshot-stale");
    });
    const freshSend = mock(async (_message: { prompt: string }) => {});
    const staleSession = { on: () => () => {}, send: staleSend } as unknown as CopilotSession;
    const freshSession = { on: () => () => {}, send: freshSend } as unknown as CopilotSession;

    // First resume returns the stale cached handle; after eviction the next
    // resume is fresh.
    let resumeCount = 0;
    mockStreamRuntimeModules(
      {
        getSession: async () => (resumeCount++ === 0 ? staleSession : freshSession),
        evictCachedSessionIfStale: (_sessionId: string, error: unknown) =>
          error instanceof Error && error.message.toLowerCase().includes("session not found"),
      },
      {
        getCachedSnapshot: async () => ({
          id: "session-snapshot-stale",
          messages: [
            { role: "user", content: "earlier prompt" },
            { role: "assistant", content: "earlier answer" },
          ],
          queuedMessages: [],
          status: "idle",
          reasoningContent: "",
        }),
      },
    );

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver({
      sessionId: "session-snapshot-stale",
      message: userMessage("retry me"),
    });

    expect(staleSend).toHaveBeenCalledTimes(1);
    expect(freshSend).toHaveBeenCalledTimes(1);
    // The healed stream is live, snapshot-seeded, and carries the retried turn.
    const stream = ImportedSessionStream.get("session-snapshot-stale");
    expect(
      stream!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer", "retry me"]);
  });
});

describe("single-flight stream acquisition", () => {
  test("concurrent background sends share one acquisition: creator sends, joiner queues", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-single-flight");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      on: () => () => {},
      send: sendMock,
    } as unknown as CopilotSession;

    // Hold both callers inside the acquisition window (the slow cold load)
    // until released, so the second call genuinely races the first.
    let releaseResume!: () => void;
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const withSessionMock = mock(
      async <T>(_sessionId: string, operation: (session: CopilotSession) => Promise<T>) => {
        await resumeGate;
        return operation({ getEvents: async () => [] } as unknown as CopilotSession);
      },
    );

    mockStreamRuntimeModules({
      withSession: withSessionMock,
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    const first = importedDeliver({
      sessionId: "session-single-flight",
      message: userMessage("first prompt"),
    });
    const second = importedDeliver({
      sessionId: "session-single-flight",
      message: userMessage("second prompt"),
    });
    releaseResume();
    await Promise.all([first, second]);

    // One cold load, one turn; the joiner's message queued behind it.
    expect(withSessionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ prompt: "first prompt", attachments: undefined });
    const stream = ImportedSessionStream.get("session-single-flight");
    expect(stream!.getQueuedMessages()).toEqual([
      expect.objectContaining({ role: "user", content: "second prompt" }),
    ]);
  });

  test("a client prompt during a background acquisition joins the created stream and queues", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-client-join");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = {
      on: () => () => {},
      send: sendMock,
    } as unknown as CopilotSession;

    let releaseResume!: () => void;
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    mockStreamRuntimeModules({
      withSession: async <T>(
        _sessionId: string,
        operation: (session: CopilotSession) => Promise<T>,
      ) => {
        await resumeGate;
        return operation({ getEvents: async () => [] } as unknown as CopilotSession);
      },
      getSession: async () => fakeSession,
    });

    const {
      deliverSessionMessage: importedDeliver,
      connectClientStream: importedConnectStream,
      SessionStream: ImportedSessionStream,
    } = await import("./index");

    // Background sender enters the acquisition window first...
    const background = importedDeliver({
      sessionId: "session-client-join",
      message: userMessage("background prompt"),
    });
    // ...then a client prompt races in; it must join, not double-send.
    const clientIterator = importedConnectStream({
      sessionId: "session-client-join",
      prompt: "client prompt",
    });
    const clientNext = clientIterator.next();

    releaseResume();
    await background;
    const clientResult = await clientNext;

    // The joiner yields no events (its prompt was queued, not streamed).
    expect(clientResult.done).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ prompt: "background prompt", attachments: undefined });
    const stream = ImportedSessionStream.get("session-client-join");
    expect(stream!.getQueuedMessages()).toEqual([
      expect.objectContaining({ role: "user", content: "client prompt" }),
    ]);
  });
});

describe("SessionStream.waitForCompletion", () => {
  test("answers from a cached snapshot without fetching history when no stream is running", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    mockStreamRuntimeModules(
      {
        withSession: async () => {
          throw new Error("waitForCompletion with a cached snapshot must not fetch history");
        },
      },
      {
        getCachedSnapshot: async () => ({
          id: "session-snapshot-wait",
          messages: [
            { role: "user", content: "do the thing" },
            { role: "assistant", content: "Cached result" },
          ],
          queuedMessages: [],
          status: "idle",
          reasoningContent: "",
        }),
      },
    );
    const { SessionStream: ImportedSessionStream } = await import("./index");

    await expect(ImportedSessionStream.waitForCompletion("session-snapshot-wait")).resolves.toEqual(
      { response: "Cached result" },
    );
  });

  test("falls back to persisted history when no stream is running for the session", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    mockStreamRuntimeModules({
      withSession: withSessionEvents([
        {
          id: "persisted-event",
          parentId: "persisted-parent",
          timestamp: "2026-01-01T00:00:00.000Z",
          type: "assistant.message",
          data: { messageId: "persisted-message", content: "Persisted result" },
        },
      ]),
    });
    const { SessionStream: ImportedSessionStream } = await import("./index");
    await expect(ImportedSessionStream.waitForCompletion("session-not-running")).resolves.toEqual({
      response: "Persisted result",
    });
  });

  test("caches the snapshot it replays so the next read is warm", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const cacheSnapshotMock = mock((_sessionId: string, _snapshot: unknown) => {});
    mockStreamRuntimeModules(
      {
        withSession: withSessionEvents([
          {
            id: "replayed-event",
            parentId: "replayed-parent",
            timestamp: "2026-01-01T00:00:00.000Z",
            type: "assistant.message",
            data: { messageId: "replayed-message", content: "Replayed result" },
          },
        ]),
      },
      { cacheSnapshot: cacheSnapshotMock },
    );
    const { SessionStream: ImportedSessionStream } = await import("./index");

    await expect(ImportedSessionStream.waitForCompletion("session-replay-cache")).resolves.toEqual({
      response: "Replayed result",
    });
    expect(cacheSnapshotMock).toHaveBeenCalledTimes(1);
    expect(cacheSnapshotMock).toHaveBeenCalledWith(
      "session-replay-cache",
      expect.objectContaining({ id: "session-replay-cache" }),
    );
  });

  test("resolves when the current stream closes", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-close-wait");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-close-wait", fakeSession);
    const waitPromise = stream.waitForCompletion();

    stream.close();

    await expect(waitPromise).resolves.toEqual({});
  });

  test("returns the latest reduced assistant response with an error when a timeout expires", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-timeout");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-timeout", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Partial result" });

    await expect(stream.waitForCompletion(1)).resolves.toEqual({
      response: "Partial result",
      error: "Timed out waiting for the session to complete.",
    });
    expect(SessionStream.get("session-timeout")).toBe(stream);
  });

  test("returns the latest real assistant response with an error when the stream fails", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-error-completion");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-error-completion", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Partial result" });
    const waitPromise = stream.waitForCompletion();

    stream.close("error");

    await expect(waitPromise).resolves.toEqual({
      response: "Partial result",
      error: "The session ended with an error.",
    });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
  });

  test("deletion resolves waiters with the latest response and no error", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-delete-wait");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-delete-wait", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Deleted result" });
    const waitPromise = stream.waitForCompletion();

    SessionStream.remove("session-delete-wait");

    await expect(waitPromise).resolves.toEqual({ response: "Deleted result" });
  });

  test("waits for the captured stream instance, not a future replacement", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-replaced");
    });

    const makeFakeSession = () =>
      ({
        on: () => () => {},
      }) as unknown as CopilotSession;

    const first = SessionStream.getOrCreate("session-replaced", makeFakeSession());
    first.getSessionState().messages.push({ role: "assistant", content: "First result" });
    const waitPromise = first.waitForCompletion();

    first.detach();
    const second = SessionStream.getOrCreate("session-replaced", makeFakeSession());

    await expect(waitPromise).resolves.toEqual({ response: "First result" });
    expect(SessionStream.get("session-replaced")).toBe(second);
  });
});
