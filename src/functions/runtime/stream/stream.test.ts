import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { deliverSessionMessage, SessionStream } from "./index";
import * as realSnapshotCache from "../../state/session/snapshots";
import * as realWorkspaceState from "../../state/workspace";
import * as realBroadcast from "../broadcast";
import { replaySdkHistory } from "@/functions/sdk/historyReplay";
import { toSessionSnapshot } from "@/lib/session/sessionReducer";
import type { QueuedMessage, QueuedUserMessage, SessionEvent, SessionSnapshot } from "@/types";

const realSnapshotCacheExports = { ...realSnapshotCache };
const realWorkspaceStateExports = { ...realWorkspaceState };
const realBroadcastExports = { ...realBroadcast };

type SessionEvents = Awaited<ReturnType<CopilotSession["getEvents"]>>;

type MockWithSession = <T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
) => Promise<T>;

function userMessage(content: string, id: string = crypto.randomUUID()): QueuedUserMessage {
  return { id, role: "user", content };
}

function artifactEdit(path: string, id: string = crypto.randomUUID()): QueuedMessage {
  return { id, role: "agent_notification", notification: { type: "artifact_edited", path } };
}

function closeStream(sessionId: string): void {
  SessionStream.get(sessionId)?.close();
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

/** Minimal fake SDK session for driving a stream without real SDK behavior.
 *  Override `send`/`abort`/`setModel` where a test needs them to misbehave. */
function makeFakeSession(overrides: Record<string, unknown> = {}): CopilotSession {
  return {
    on: () => () => {},
    send: async () => {},
    ...overrides,
  } as unknown as CopilotSession;
}

/** Fake SDK session that captures its event listener so tests can play SDK
 *  events back into the stream. Emission is synchronous, exactly like the SDK
 *  callback; pair turn-terminal events with `await settle()` to let the
 *  floating queue drain and close land before asserting. */
function makeControllableSession(overrides: Record<string, unknown> = {}) {
  let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
  const session = {
    on: (handler: (event: { type: string; data: unknown }) => void) => {
      sdkHandler = handler;
      return () => {};
    },
    send: async () => {},
    ...overrides,
  } as unknown as CopilotSession;

  return {
    session,
    emitSdkEvent: (type: string, data: unknown = {}) => sdkHandler!({ type, data }),
  };
}

/** Let the runtime's floating continuations settle before asserting. */
const settle = () => Bun.sleep(0);

/** Mock the runtime modules SessionStream imports so tests can drive streams with
 *  fake SDK sessions. Callers override the sessionRegistry and snapshotCache
 *  behavior they need; the defaults fail loudly if an unexpected path is
 *  taken, and the default snapshot cache is always empty. */
function mockStreamRuntimeModules(
  sessionRegistryOverrides: Record<string, unknown> = {},
  snapshotCacheOverrides: Record<string, unknown> = {},
  broadcastOverrides: Record<string, unknown> = {},
  workspaceOverrides: Record<string, unknown> = {},
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
      const snapshot = toSessionSnapshot(sessionId, replaySdkHistory(sessionId, events));
      cacheSnapshot(sessionId, snapshot);
      return snapshot;
    });

  mock.module("../../state/session/registry", () => ({
    createSession: async () => {
      throw new Error("createSession mock was not provided");
    },
    getSession: async () => {
      throw new Error("getSession mock was not provided");
    },
    withSession: async () => {
      throw new Error("withSession mock was not provided");
    },
    deleteSession: async () => {
      throw new Error("deleteSession mock was not provided");
    },
    deleteSessionIfExists: async () => {
      throw new Error("deleteSessionIfExists mock was not provided");
    },
    evictCachedSessionIfStale: () => false,
    ...sessionRegistryOverrides,
  }));
  mock.module("../../state/session/snapshots", () => ({
    ...realSnapshotCacheExports,
    getCachedSnapshot,
    cacheSnapshot,
    evictCachedSnapshot: () => {},
    loadSessionSnapshot,
    ...snapshotCacheOverrides,
  }));
  onTestFinished(() => {
    mock.module("../../state/session/snapshots", () => realSnapshotCacheExports);
  });
  mock.module("../../state/workspace", () => ({
    ...realWorkspaceStateExports,
    setSessionStatus: () => {},
    clearDraftPrompt: () => {},
    ...workspaceOverrides,
  }));
  onTestFinished(() => {
    mock.module("../../state/workspace", () => realWorkspaceStateExports);
  });
  mock.module("../broadcast", () => ({
    ...realBroadcastExports,
    emitSessionNameUpdate: () => {},
    emitAutomationEvent: () => {},
    subscribeAutomationEvents: () => () => {},
    ...broadcastOverrides,
  }));
  onTestFinished(() => {
    mock.module("../broadcast", () => realBroadcastExports);
  });
}

describe("SessionStream lifecycle", () => {
  test("close clears the queue, signals end-of-stream, and deregisters", async () => {
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-close-semantics", fakeSession);
    const events = stream.subscribe();

    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
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
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-detach-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
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
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-idle-unsubscribe", fakeSession);
    const events = stream.subscribe();

    await events.return();

    expect(SessionStream.isRunning("session-idle-unsubscribe")).toBe(false);
  });

  test("marks a completed stream unread after its client disconnects", async () => {
    const sessionId = "session-disconnected-unread";
    onTestFinished(() => {
      mock.restore();
      closeStream(sessionId);
    });

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({}, {}, {}, { setSessionStatus });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const stream = ImportedSessionStream.getOrCreate(sessionId, makeFakeSession());
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    await events.return();
    stream.close();

    expect(setSessionStatus).toHaveBeenCalledTimes(2);
    expect(setSessionStatus).toHaveBeenNthCalledWith(1, sessionId, "running");
    expect(setSessionStatus).toHaveBeenNthCalledWith(2, sessionId, "unread");
  });

  test("uses subscription mode to resolve completed stream status", async () => {
    const activeSessionId = "session-active-subscriber";
    const passiveSessionId = "session-passive-subscriber";
    onTestFinished(() => {
      mock.restore();
      closeStream(activeSessionId);
      closeStream(passiveSessionId);
    });

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({}, {}, {}, { setSessionStatus });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const activeStream = ImportedSessionStream.getOrCreate(activeSessionId, makeFakeSession());
    const activeEvents = activeStream.subscribe();
    await activeStream.deliver(userMessage("go"));
    activeStream.close();
    await activeEvents.return();

    const passiveStream = ImportedSessionStream.getOrCreate(passiveSessionId, makeFakeSession());
    const passiveEvents = passiveStream.subscribe(undefined, "passive");
    await passiveStream.deliver(userMessage("go"));
    passiveStream.close();
    await passiveEvents.return();

    expect(setSessionStatus.mock.calls).toEqual([
      [activeSessionId, "running"],
      [activeSessionId, "idle"],
      [passiveSessionId, "running"],
      [passiveSessionId, "unread"],
    ]);
  });

  test("remove publishes a terminal event without global lifecycle updates", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-remove-semantics");
    });

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({}, {}, {}, { setSessionStatus });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const fakeSession = makeFakeSession();

    const stream = ImportedSessionStream.getOrCreate("session-remove-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
    setSessionStatus.mockClear();

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
    expect(setSessionStatus).toHaveBeenCalledTimes(0);
  });

  test("closed streams reject late delivery and queue cancellation", async () => {
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-closed-mutations", fakeSession);
    stream.close();

    await expect(stream.deliver(userMessage("late follow-up", "late"))).rejects.toThrow(
      "Session stream closed before the message could be delivered.",
    );
    expect(stream.cancelQueuedMessage("late")).toBe(false);

    expect(stream.getQueuedMessages()).toEqual([]);
  });

  test("abort closes and deregisters even when the SDK abort fails", async () => {
    onTestFinished(() => {
      closeStream("session-abort-failure");
    });

    const fakeSession = makeFakeSession({
      abort: async () => {
        throw new Error("abort exploded");
      },
    });

    const stream = SessionStream.getOrCreate("session-abort-failure", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    await expect(stream.abort()).rejects.toThrow("abort exploded");

    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "user_message",
      "end",
    ]);
    expect(SessionStream.isRunning("session-abort-failure")).toBe(false);
  });

  test("an explicit abort finishes idle after its client disconnects", async () => {
    const sessionId = "session-disconnected-abort";
    onTestFinished(() => {
      mock.restore();
      closeStream(sessionId);
    });

    const statuses: string[] = [];
    mockStreamRuntimeModules(
      {},
      {},
      {},
      {
        setSessionStatus: (_sessionId: string, status: string) => statuses.push(status),
      },
    );

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const stream = ImportedSessionStream.getOrCreate(
      sessionId,
      makeFakeSession({ abort: async () => {} }),
    );
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await events.return();
    await stream.abort();

    expect(statuses).toEqual(["running", "idle"]);
  });

  test("drains the queue on idle: dequeues, sends, then closes when empty", async () => {
    onTestFinished(() => {
      closeStream("session-drain");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });

    const stream = SessionStream.getOrCreate("session-drain", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("first turn"));
    await stream.deliver(userMessage("second turn", "q1"));

    // First idle: drains the queue into turn 2.
    emitSdkEvent("session.idle");
    await settle();

    expect(sendMock).toHaveBeenCalledWith({ prompt: "second turn", attachments: undefined });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince().map((event) => event.type)).toContain("message_dequeued");
    expect(SessionStream.isRunning("session-drain")).toBe(true);

    // Second idle with an empty queue: closes the stream.
    emitSdkEvent("session.idle");
    await settle();

    expect((await collectStreamEvents(events)).map((event) => event.type)).toContain(
      "message_dequeued",
    );
    expect(SessionStream.isRunning("session-drain")).toBe(false);
  });

  test("closes the stream when draining fails to send", async () => {
    let sendCount = 0;
    const { session, emitSdkEvent } = makeControllableSession({
      // The first turn sends fine; the drained follow-up explodes.
      send: async () => {
        if (++sendCount > 1) throw new Error("send exploded");
      },
    });

    const stream = SessionStream.getOrCreate("session-drain-failure", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("first turn"));
    await stream.deliver(userMessage("doomed follow-up"));

    emitSdkEvent("session.idle");
    await settle();

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
      closeStream("session-sdk-error");
    });

    const { session, emitSdkEvent } = makeControllableSession();

    const stream = SessionStream.getOrCreate("session-sdk-error", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    emitSdkEvent("session.error");

    const emitted = await collectStreamEvents(events);
    expect(emitted.map((event) => event.type)).toEqual(["user_message", "end"]);
    expect(emitted.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-sdk-error")).toBe(false);
  });

  test("cancelQueuedMessage cancels known ids and rejects unknown ones", async () => {
    onTestFinished(() => {
      closeStream("session-queue-remove");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-queue-remove", fakeSession);
    await stream.deliver(userMessage("active", "active"));
    await stream.deliver(userMessage("keep me", "q1"));
    await stream.deliver(userMessage("cancel me", "q2"));

    expect(stream.cancelQueuedMessage("missing")).toBe(false);
    expect(stream.cancelQueuedMessage("q2")).toBe(true);
    expect(stream.getQueuedMessages().map((m) => m.id)).toEqual(["q1"]);
  });
});

describe("queued-message coalescing", () => {
  test("collapses equivalent notifications and always queues normal prompts", async () => {
    onTestFinished(() => {
      closeStream("session-coalesce");
    });

    const fakeSession = makeFakeSession();
    const stream = SessionStream.getOrCreate("session-coalesce", fakeSession);
    await stream.deliver(userMessage("Already running", "active-turn"));

    // Editing the same artifact twice collapses to a single nudge.
    await deliverSessionMessage("session-coalesce", {
      id: "plan-edit-1",
      notification: { type: "artifact_edited", path: "plan.md" },
    });
    await deliverSessionMessage("session-coalesce", {
      id: "plan-edit-2",
      notification: { type: "artifact_edited", path: "plan.md" },
    });
    expect(stream.getQueuedMessages()).toHaveLength(1);

    // A different artifact is its own notification.
    await deliverSessionMessage("session-coalesce", {
      id: "other-edit",
      notification: { type: "artifact_edited", path: "other.md" },
    });
    expect(stream.getQueuedMessages()).toHaveLength(2);

    // Normal prompts never coalesce.
    await deliverSessionMessage("session-coalesce", userMessage("hello", "hello-1"));
    await deliverSessionMessage("session-coalesce", userMessage("hello", "hello-2"));
    expect(stream.getQueuedMessages()).toHaveLength(4);
  });

  test("coalesces notifications delivered directly to an active stream", async () => {
    onTestFinished(() => {
      closeStream("session-coalesce-direct");
    });

    const fakeSession = makeFakeSession();
    const stream = SessionStream.getOrCreate("session-coalesce-direct", fakeSession);
    await stream.deliver(userMessage("Already running", "active-turn"));

    await stream.deliver(artifactEdit("plan.md", "edit-1"));
    await stream.deliver(artifactEdit("plan.md", "edit-2"));
    await stream.deliver(userMessage("hello", "u1"));
    await stream.deliver(userMessage("hello", "u2"));

    expect(stream.getQueuedMessages().map((message) => message.id)).toEqual(["edit-1", "u1", "u2"]);
  });
});

describe("SessionStream event replay", () => {
  test("getReplayEventsSince filters by cursor and returns a defensive copy", async () => {
    onTestFinished(() => {
      closeStream("session-replay-since");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-replay-since", fakeSession);
    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("one", "q1"));
    await stream.deliver(userMessage("two", "q2"));

    const all = stream.getReplayEventsSince();
    expect(all.map((e) => e.type)).toEqual(["user_message", "message_queued", "message_queued"]);

    const afterFirst = stream.getReplayEventsSince(all[0].eventId);
    expect(afterFirst.map((e) => e.type)).toEqual(["message_queued", "message_queued"]);

    // Mutating the returned array must not affect retained replay.
    all.length = 0;
    expect(stream.getReplayEventsSince().length).toBe(3);
  });

  test("caps replay history at the retention limit, keeping the newest events", () => {
    onTestFinished(() => {
      closeStream("session-replay-cap");
    });

    const { session, emitSdkEvent } = makeControllableSession();

    const stream = SessionStream.getOrCreate("session-replay-cap", session);
    for (let i = 0; i < 1600; i++) {
      emitSdkEvent("assistant.message_delta", { deltaContent: `chunk-${i} ` });
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
      closeStream("session-event-id-reuse");
    });

    const first = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    await first.deliver(userMessage("First run"));
    const firstEventId = first.getReplayEventsSince()[0]?.eventId;
    first.detach();

    const second = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    await second.deliver(userMessage("Second run"));
    const secondEventId = second.getReplayEventsSince()[0]?.eventId;

    expect(firstEventId).toEqual(expect.any(Number));
    expect(secondEventId).toEqual(expect.any(Number));
    expect(secondEventId!).toBeGreaterThan(firstEventId!);
  });

  test("do not regress after a synchronous burst faster than 1 event/ms", async () => {
    onTestFinished(() => {
      closeStream("session-event-id-burst");
    });

    const { session, emitSdkEvent } = makeControllableSession();

    // A synchronous burst mints ids faster than wall time advances, pushing
    // the last issued id well past Date.now().
    const first = SessionStream.getOrCreate("session-event-id-burst", session);
    await first.deliver(userMessage("burst"));
    for (let i = 0; i < 2000; i++) {
      emitSdkEvent("assistant.message_delta", { deltaContent: `chunk-${i} ` });
    }
    const lastBurstEventId = first.getReplayEventsSince().at(-1)!.eventId!;
    first.detach();

    // A replacement stream for the same session must keep ids increasing, or
    // the client's lastSeenEventId filter would silently drop its events.
    const second = SessionStream.getOrCreate("session-event-id-burst", makeFakeSession());
    await second.deliver(userMessage("after burst"));

    expect(second.getReplayEventsSince()[0]!.eventId!).toBeGreaterThan(lastBurstEventId);
  });
});

describe("SessionStream model", () => {
  test("a turn model emits model_changed into live stream state", async () => {
    onTestFinished(() => {
      closeStream("session-model-change");
    });

    const setModelMock = mock(
      async (_model: string, _options?: { reasoningEffort?: string }) => {},
    );
    const fakeSession = makeFakeSession({ setModel: setModelMock });

    const stream = SessionStream.getOrCreate("session-model-change", fakeSession);
    const events = stream.subscribe();

    await stream.deliver({
      id: "model-turn",
      role: "user",
      content: "Use this model",
      model: { name: "gpt-5.5", reasoningEffort: "high" },
    });

    expect(setModelMock).toHaveBeenCalledWith("gpt-5.5", { reasoningEffort: "high" });
    expect(stream.getSessionState().model).toEqual({
      name: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({ type: "user_message" }),
    );
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({
        type: "model_changed",
        model: { name: "gpt-5.5", reasoningEffort: "high" },
      }),
    );
    await events.return();
  });
});

describe("streamSession", () => {
  test("reuses the active stream for reconnects without replaying SDK history", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-reconnect");
    });

    const fakeSession = makeFakeSession();

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-reconnect", fakeSession, {
      model: { name: "gpt-5" },
    });
    await stream.deliver(userMessage("Reconnect me"));

    const iterator = importedStreamSession({ sessionId: "session-reconnect" });
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Reconnect me",
    });
  });

  test("deduplicates stale draft-start requests by message id while reconnecting", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-draft-race");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });
    const clearDraftPromptMock = mock((_sessionId: string) => {});

    mockStreamRuntimeModules({}, {}, {}, { clearDraftPrompt: clearDraftPromptMock });

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-draft-race", fakeSession, {
      model: { name: "gpt-5" },
    });
    await stream.deliver(userMessage("Original draft prompt", "client-1"));

    const iterator = importedStreamSession({
      sessionId: "session-draft-race",
      message: userMessage("Original draft prompt", "client-1"),
      create: {},
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
    expect(clearDraftPromptMock).toHaveBeenCalledWith("session-draft-race");
  });

  test("stays subscribed when a client prompt queues onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-client-delivered-queue");
    });

    const fakeSession = makeFakeSession();
    const clearDraftPromptMock = mock((_sessionId: string) => {});

    mockStreamRuntimeModules({}, {}, {}, { clearDraftPrompt: clearDraftPromptMock });

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-client-delivered-queue", fakeSession);
    await stream.deliver(userMessage("Already running"));

    const iterator = importedStreamSession({
      sessionId: "session-client-delivered-queue",
      message: { id: "queued-client", content: "Queue this client prompt" },
    });
    const first = await iterator.next();
    const second = await iterator.next();
    await iterator.return?.(undefined);

    expect(first).toMatchObject({
      done: false,
      value: { type: "user_message", content: "Already running" },
    });
    expect(second).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: { id: "queued-client", content: "Queue this client prompt" },
      },
    });
    expect(clearDraftPromptMock).toHaveBeenCalledWith("session-client-delivered-queue");
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        role: "user",
        content: "Queue this client prompt",
      }),
    ]);
  });

  test("queues a distinct message even when it carries creation options", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-distinct-create-message");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate(
      "session-distinct-create-message",
      fakeSession,
    );
    await stream.deliver(userMessage("Original message", "original-message"));

    const iterator = importedStreamSession({
      sessionId: "session-distinct-create-message",
      message: userMessage("Distinct follow-up", "distinct-message"),
      create: {},
    });
    await iterator.next();
    await iterator.next();
    await iterator.return?.(undefined);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({ id: "distinct-message", content: "Distinct follow-up" }),
    ]);
  });

  test("clears the draft prompt when a client prompt starts a new stream turn", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-client-delivered-start");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });
    const clearDraftPromptMock = mock((_sessionId: string) => {});

    mockStreamRuntimeModules(
      {
        createSession: async () => fakeSession,
      },
      {},
      {},
      { clearDraftPrompt: clearDraftPromptMock },
    );

    const { streamSession: importedStreamSession } = await import("./index");

    const iterator = importedStreamSession({
      sessionId: "session-client-delivered-start",
      message: userMessage("Start this client prompt"),
      create: {},
    });
    const first = await iterator.next();
    await settle();
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Start this client prompt",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(clearDraftPromptMock).toHaveBeenCalledWith("session-client-delivered-start");
  });

  test("starts a new stream turn for an attachment-only client message", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-client-attachment-only");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });
    const attachment = {
      displayName: "image.png",
      base64: "aW1hZ2U=",
      mimeType: "image/png",
    };

    mockStreamRuntimeModules({
      createSession: async () => fakeSession,
    });

    const { streamSession: importedStreamSession } = await import("./index");

    const iterator = importedStreamSession({
      sessionId: "session-client-attachment-only",
      message: {
        id: "attachment-only",
        content: "",
        attachments: [attachment],
      },
      create: {},
    });
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "",
      attachments: [attachment],
    });
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "",
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

  test("retries a client follow-up if the active stream closes before delivery", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-client-queue-retry");
    });

    const activeSession = makeFakeSession();

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

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-client-queue-retry", activeSession);
    await stream.deliver(userMessage("Already running"));

    const originalDeliver = stream.deliver.bind(stream);
    let closedBeforeDelivery = false;
    stream.deliver = ((message: QueuedMessage) => {
      if (!closedBeforeDelivery) {
        closedBeforeDelivery = true;
        stream.close();
      }

      return originalDeliver(message);
    }) as typeof stream.deliver;

    const events = await collectStreamEvents(
      importedStreamSession({
        sessionId: "session-client-queue-retry",
        message: userMessage("Follow-up after close"),
      }),
    );

    expect(closedBeforeDelivery).toBe(true);
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
      closeStream("session-short-response");
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

    const { streamSession: importedStreamSession } = await import("./index");

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of importedStreamSession({
      sessionId: "session-short-response",
      message: userMessage("What is France's capital?"),
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
      closeStream("session-first-send-failure");
    });

    const evictMock = mock((_sessionId: string, _error: unknown) => false);
    const fakeSession = makeFakeSession({
      send: async () => {
        throw new Error("send exploded");
      },
    });

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
      evictCachedSessionIfStale: evictMock,
    });

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const iterator = importedStreamSession({
      sessionId: "session-first-send-failure",
      message: userMessage("doomed prompt"),
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

describe("message receipts", () => {
  test("returns a queued receipt when the target stream is already live", async () => {
    onTestFinished(() => {
      closeStream("session-delivery-queued");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-delivery-queued", fakeSession);
    await stream.deliver(userMessage("Already running"));

    const receipt = await deliverSessionMessage(
      "session-delivery-queued",
      userMessage("Queue through delivery"),
    );

    expect(receipt.disposition).toBe("queued");
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({ content: "Queue through delivery" }),
    ]);

    const completion = receipt.waitForCompletion();
    stream.close();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("returns a started receipt when the message opens an idle session turn", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-delivery-sent");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver } = await import("./index");

    const receipt = await importedDeliver(
      "session-delivery-sent",
      userMessage("Start through delivery"),
    );

    expect(receipt.disposition).toBe("started");
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start through delivery",
      attachments: undefined,
    });

    const completion = receipt.waitForCompletion();
    closeStream("session-delivery-sent");
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("returns the original disposition when the same message id is delivered again", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-delivery-idempotent");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");
    const message = userMessage("Only once", "same-message");

    const first = await importedDeliver("session-delivery-idempotent", message);
    const duplicate = await importedDeliver("session-delivery-idempotent", message);

    expect(first.disposition).toBe("started");
    expect(duplicate.disposition).toBe("started");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(ImportedSessionStream.get("session-delivery-idempotent")?.getQueuedMessages()).toEqual(
      [],
    );
  });
});

describe("createSession", () => {
  test("creates the session and starts its first message as one operation", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-headless-create");
    });

    const calls: string[] = [];
    const sendMock = mock(async (_message: { prompt: string }) => {
      calls.push("send");
    });
    const fakeSession = makeFakeSession({ send: sendMock });
    const createSessionMock = mock(
      async (_sessionId: string, _options: Record<string, unknown>) => {
        calls.push("create");
        return fakeSession;
      },
    );
    const emitSessionNameUpdateMock = mock((_sessionId: string, _summary: string) => {
      calls.push("name");
    });
    const setSessionStatus = mock((_sessionId: string, status: string) => {
      calls.push(status);
    });

    mockStreamRuntimeModules(
      { createSession: createSessionMock },
      {},
      { emitSessionNameUpdate: emitSessionNameUpdateMock },
      { setSessionStatus },
    );

    const { createSession: importedCreate } = await import("./index");
    const receipt = await importedCreate(
      "session-headless-create",
      {
        id: "first-message",
        content: "Start in the background",
        model: { name: "gpt-5.5", reasoningEffort: "high" },
      },
      {
        directory: "/repo",
        useWorktree: true,
        parentSessionId: "parent-session",
        initialContext: { workingDirectory: "/repo" },
        sessionType: "child",
        summary: "Background task",
      },
    );

    expect(receipt.disposition).toBe("started");
    expect(createSessionMock).toHaveBeenCalledWith("session-headless-create", {
      model: { name: "gpt-5.5", reasoningEffort: "high" },
      directory: "/repo",
      useWorktree: true,
      parentSessionId: "parent-session",
      initialContext: { workingDirectory: "/repo" },
      sessionType: "child",
    });
    expect(emitSessionNameUpdateMock).toHaveBeenCalledWith(
      "session-headless-create",
      "Background task",
    );
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start in the background",
      attachments: undefined,
    });
    expect(calls).toEqual(["creating", "create", "name", "running", "send"]);
  });

  test("restores the pre-session state when creation fails", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-create-failure");
    });

    const statuses: string[] = [];
    mockStreamRuntimeModules(
      {
        createSession: async () => {
          throw new Error("create exploded");
        },
      },
      {},
      {},
      {
        setSessionStatus: (_sessionId: string, status: string) => statuses.push(status),
      },
    );

    const { createSession: importedCreate } = await import("./index");
    await expect(
      importedCreate("session-create-failure", userMessage("first message"), {
        directory: "/repo",
      }),
    ).rejects.toThrow("create exploded");

    expect(statuses).toEqual(["creating", "idle"]);
  });
});

describe("deliverSessionMessage", () => {
  test("queues prompts onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-queue-helper");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-queue-helper", fakeSession, {
      model: { name: "gpt-5" },
    });
    await stream.deliver(userMessage("Already running"));

    const { deliverSessionMessage: importedDeliver } = await import("./index");

    await importedDeliver("session-queue-helper", { content: "Queue this follow-up" });

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
      closeStream("session-start-helper");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      withSession: withSessionEvents([]),
      getSession: async () => fakeSession,
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver("session-start-helper", {
      id: "start-helper",
      content: "Start this session again",
      attachments: [
        {
          displayName: "image.png",
          base64: "aW1hZ2U=",
          mimeType: "image/png",
        },
      ],
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
      closeStream("session-snapshot-seed");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

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

    await importedDeliver("session-snapshot-seed", userMessage("follow-up question"));

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
      closeStream("session-snapshot-stale");
    });

    const staleSend = mock(async () => {
      throw new Error("Session not found: session-snapshot-stale");
    });
    const freshSend = mock(async (_message: { prompt: string }) => {});
    const staleSession = makeFakeSession({ send: staleSend });
    const freshSession = makeFakeSession({ send: freshSend });

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

    await importedDeliver("session-snapshot-stale", userMessage("retry me"));

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
      closeStream("session-single-flight");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

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

    const first = importedDeliver("session-single-flight", userMessage("first prompt"));
    const second = importedDeliver("session-single-flight", userMessage("second prompt"));
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
      closeStream("session-client-join");
    });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

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
      streamSession: importedStreamSession,
      SessionStream: ImportedSessionStream,
    } = await import("./index");

    // Background sender enters the acquisition window first...
    const background = importedDeliver("session-client-join", userMessage("background prompt"));
    // ...then a client prompt races in; it must join, not double-send.
    const clientIterator = importedStreamSession({
      sessionId: "session-client-join",
      message: userMessage("client prompt"),
    });
    const clientNext = clientIterator.next();

    releaseResume();
    await background;
    const clientResult = await clientNext;

    // The connected joiner observes the stream it queued onto.
    expect(clientResult).toMatchObject({
      done: false,
      value: { type: "user_message", content: "background prompt" },
    });
    await clientIterator.return?.(undefined);
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
      { status: "completed", response: "Cached result" },
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
      status: "completed",
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
      status: "completed",
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
      closeStream("session-close-wait");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-close-wait", fakeSession);
    const waitPromise = stream.waitForCompletion();

    stream.close();

    await expect(waitPromise).resolves.toEqual({ status: "completed" });
  });

  test("returns timed-out status with the latest reduced assistant response", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-timeout");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-timeout", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Partial result" });

    await expect(stream.waitForCompletion(1)).resolves.toEqual({
      status: "timed_out",
      response: "Partial result",
    });
    expect(SessionStream.get("session-timeout")).toBe(stream);
  });

  test("returns failed status with the latest real assistant response", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-error-completion");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-error-completion", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Partial result" });
    const waitPromise = stream.waitForCompletion();

    stream.close("error");

    await expect(waitPromise).resolves.toEqual({
      status: "failed",
      response: "Partial result",
    });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
  });

  test("deletion resolves waiters as completed with the latest response", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-delete-wait");
    });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-delete-wait", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Deleted result" });
    const waitPromise = stream.waitForCompletion();

    SessionStream.remove("session-delete-wait");

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "Deleted result",
    });
  });

  test("waits for the captured stream instance, not a future replacement", async () => {
    onTestFinished(() => {
      mock.restore();
      closeStream("session-replaced");
    });

    const first = SessionStream.getOrCreate("session-replaced", makeFakeSession());
    first.getSessionState().messages.push({ role: "assistant", content: "First result" });
    const waitPromise = first.waitForCompletion();

    first.detach();
    const second = SessionStream.getOrCreate("session-replaced", makeFakeSession());

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "First result",
    });
    expect(SessionStream.get("session-replaced")).toBe(second);
  });
});
