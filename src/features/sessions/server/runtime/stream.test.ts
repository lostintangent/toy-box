import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import {
  deliverSessionMessage,
  registerPendingSessionCompletion,
  rejectPendingSessionCompletion,
  SessionStream,
  waitForSession,
} from "./index";
import * as realSnapshotCache from "@sessions/server/state/snapshots";
import * as realWorkspaceState from "@workspace/server/state";
import {
  deleteSessionState,
  getSessionState as getWorkspaceSessionState,
} from "@workspace/server/state/sessions";
import * as realBroadcast from "@workspace/server/events";
import { replaySdkHistory } from "@sessions/server/sdk/historyReplay";
import { encodeSdkAgentNotification } from "@sessions/server/sdk/agentNotificationCodec";
import { toSessionSnapshot } from "@sessions/model/reducer";
import type {
  QueuedMessage,
  QueuedUserMessage,
  SessionEvent,
  SessionSnapshot,
} from "@sessions/model";

const realSnapshotCacheExports = { ...realSnapshotCache };
const realWorkspaceStateExports = { ...realWorkspaceState };
const realBroadcastExports = { ...realBroadcast };

type SessionEvents = Awaited<ReturnType<CopilotSession["getEvents"]>>;

type MockWithSession = <T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
) => Promise<T>;

function userMessage(content: string, clientId: string = crypto.randomUUID()): QueuedUserMessage {
  return { clientId, role: "user", content };
}

function fileEdit(
  path: string,
  clientId: string = crypto.randomUUID(),
): Extract<QueuedMessage, { role: "agent_notification" }> {
  return {
    clientId,
    role: "agent_notification",
    notification: {
      type: "file_edited",
      file: { type: "session", sessionId: "notify-session", path },
    },
  };
}

function finishStream(sessionId: string): void {
  SessionStream.get(sessionId)?.finish();
}

function cleanUpStreamAfterTest(
  sessionId: string,
  { restoreMocks = false }: { restoreMocks?: boolean } = {},
): void {
  onTestFinished(() => {
    if (restoreMocks) mock.restore();
    finishStream(sessionId);
  });
}

function restoreMocksAfterTest(): void {
  onTestFinished(() => mock.restore());
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
    abort: async () => {},
    rpc: { queue: { clear: async () => {} } },
    ...overrides,
  } as unknown as CopilotSession;
}

function createStreamWithAssistantResponse(sessionId: string, response: string): SessionStream {
  return SessionStream.getOrCreate(sessionId, makeFakeSession(), {
    messages: [{ role: "assistant", content: response }],
  });
}

/** Fake SDK session that captures its event listener so tests can play SDK
 *  events back into the stream. Emission is synchronous, exactly like the SDK
 *  callback; pair turn-terminal events with `await settle()` to let the
 *  floating queue drain and finish land before asserting. */
function makeControllableSession(overrides: Record<string, unknown> = {}) {
  let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
  const session = {
    on: (handler: (event: { type: string; data: unknown }) => void) => {
      sdkHandler = handler;
      return () => {};
    },
    send: async () => {},
    abort: async () => {},
    rpc: { queue: { clear: async () => {} } },
    ...overrides,
  } as unknown as CopilotSession;

  return {
    session,
    emitSdkEvent: (type: string, data: unknown = {}) => sdkHandler!({ type, data }),
  };
}

/** Let the runtime's floating continuations settle before asserting. */
const settle = () => Bun.sleep(0);

function idleSnapshot(sessionId: string, messages: SessionSnapshot["messages"]): SessionSnapshot {
  return {
    id: sessionId,
    messages,
    queuedMessages: [],
    status: "idle",
    reasoningContent: "",
  };
}

type StreamRuntimeModuleMocks = {
  sessionRegistry?: Record<string, unknown>;
  snapshotCache?: Record<string, unknown>;
  broadcast?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
};

/** Mock the runtime modules SessionStream imports so tests can drive streams with
 *  fake SDK sessions. Callers override the sessionRegistry and snapshotCache
 *  behavior they need; the defaults fail loudly if an unexpected path is
 *  taken, and the default snapshot cache is always empty. */
function mockStreamRuntimeModules({
  sessionRegistry: sessionRegistryOverrides = {},
  snapshotCache: snapshotCacheOverrides = {},
  broadcast: broadcastOverrides = {},
  workspace: workspaceOverrides = {},
}: StreamRuntimeModuleMocks = {}) {
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

  mock.module("@sessions/server/state/registry", () => ({
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
  mock.module("@sessions/server/state/snapshots", () => ({
    ...realSnapshotCacheExports,
    getCachedSnapshot,
    cacheSnapshot,
    evictCachedSnapshot: () => {},
    loadSessionSnapshot,
    ...snapshotCacheOverrides,
  }));
  onTestFinished(() => {
    mock.module("@sessions/server/state/snapshots", () => realSnapshotCacheExports);
  });
  mock.module("@workspace/server/state", () => ({
    ...realWorkspaceStateExports,
    setSessionStatus: () => {},
    clearDraftPrompt: () => {},
    ...workspaceOverrides,
  }));
  onTestFinished(() => {
    mock.module("@workspace/server/state", () => realWorkspaceStateExports);
  });
  mock.module("@workspace/server/events", () => ({
    ...realBroadcastExports,
    emitSessionNameUpdate: () => {},
    ...broadcastOverrides,
  }));
  onTestFinished(() => {
    mock.module("@workspace/server/events", () => realBroadcastExports);
  });
}

describe("SessionStream lifecycle", () => {
  test("finish clears the queue, signals end-of-stream, and deregisters", async () => {
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finish-semantics", fakeSession);
    const events = stream.subscribe();

    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
    stream.finish();

    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "message_queued",
      "end",
    ]);
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince()).toEqual([]);
    expect(SessionStream.isRunning("session-finish-semantics")).toBe(false);
  });

  test("caches the canonical final state before publishing terminal status", async () => {
    const sessionId = "session-finish-cache";
    cleanUpStreamAfterTest(sessionId, { restoreMocks: true });

    const transitions: string[] = [];
    const cacheSnapshot = mock((_sessionId: string, snapshot: SessionSnapshot) => {
      transitions.push(`cache:${snapshot.status}`);
    });
    const setSessionStatus = mock((_sessionId: string, status: string) => {
      transitions.push(`status:${status}`);
    });
    mockStreamRuntimeModules({
      snapshotCache: { cacheSnapshot },
      workspace: { setSessionStatus },
    });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const stream = ImportedSessionStream.getOrCreate(sessionId, makeFakeSession());
    const subscription = stream.subscribe();
    await stream.deliver(userMessage("go"));
    transitions.length = 0;

    stream.finish();

    const events = await collectStreamEvents(subscription);
    expect(events.map((event) => event.type)).toEqual(["end"]);
    expect(cacheSnapshot).toHaveBeenCalledTimes(1);
    expect(cacheSnapshot).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        status: "idle",
        lastSeenEventId: events.at(-1)?.eventId,
      }),
    );
    expect(transitions).toEqual(["cache:idle", "status:idle"]);
  });

  test("does not cache aborted or failed live state", async () => {
    cleanUpStreamAfterTest("session-abort-no-cache", { restoreMocks: true });
    cleanUpStreamAfterTest("session-error-no-cache");

    const cacheSnapshot = mock((_sessionId: string, _snapshot: SessionSnapshot) => {});
    mockStreamRuntimeModules({ snapshotCache: { cacheSnapshot } });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const aborted = ImportedSessionStream.getOrCreate("session-abort-no-cache", makeFakeSession());
    await aborted.deliver(userMessage("abort"));
    await aborted.abort();

    const failed = ImportedSessionStream.getOrCreate("session-error-no-cache", makeFakeSession());
    await failed.deliver(userMessage("fail"));
    failed.finish("error");

    expect(cacheSnapshot).toHaveBeenCalledTimes(0);
  });

  test("emits an error end when the SDK terminates the stream with an error", async () => {
    cleanUpStreamAfterTest("session-sdk-error");

    const { session, emitSdkEvent } = makeControllableSession();

    const stream = SessionStream.getOrCreate("session-sdk-error", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    emitSdkEvent("session.error");

    const emitted = await collectStreamEvents(events);
    expect(emitted.map((event) => event.type)).toEqual(["end"]);
    expect(emitted.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-sdk-error")).toBe(false);
  });

  test("marks a completed stream unread after its client disconnects", async () => {
    const sessionId = "session-disconnected-unread";
    cleanUpStreamAfterTest(sessionId, { restoreMocks: true });

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const stream = ImportedSessionStream.getOrCreate(sessionId, makeFakeSession());
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    await events.return();
    stream.finish();

    expect(setSessionStatus).toHaveBeenCalledTimes(2);
    expect(setSessionStatus).toHaveBeenNthCalledWith(1, sessionId, "running");
    expect(setSessionStatus).toHaveBeenNthCalledWith(2, sessionId, "unread");
  });

  test("active subscribers acknowledge completion while passive subscribers do not", async () => {
    const activeSessionId = "session-active-subscriber";
    const passiveSessionId = "session-passive-subscriber";
    cleanUpStreamAfterTest(activeSessionId, { restoreMocks: true });
    cleanUpStreamAfterTest(passiveSessionId);

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const activeStream = ImportedSessionStream.getOrCreate(activeSessionId, makeFakeSession());
    const activeEvents = activeStream.subscribe();
    await activeStream.deliver(userMessage("go"));
    activeStream.finish();
    await activeEvents.return();

    const passiveStream = ImportedSessionStream.getOrCreate(passiveSessionId, makeFakeSession());
    const passiveEvents = passiveStream.subscribe(undefined, "passive");
    await passiveStream.deliver(userMessage("go"));
    passiveStream.finish();
    await passiveEvents.return();

    expect(setSessionStatus.mock.calls).toEqual([
      [activeSessionId, "running"],
      [activeSessionId, "idle"],
      [passiveSessionId, "running"],
      [passiveSessionId, "unread"],
    ]);
  });

  test("remove publishes a terminal event without global lifecycle updates", async () => {
    cleanUpStreamAfterTest("session-remove-semantics", { restoreMocks: true });

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const fakeSession = makeFakeSession();

    const stream = ImportedSessionStream.getOrCreate("session-remove-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
    setSessionStatus.mockClear();

    ImportedSessionStream.remove("session-remove-semantics");

    const emittedEvents = await collectStreamEvents(events);
    expect(emittedEvents.map((event) => event.type)).toEqual(["message_queued", "end"]);
    expect(emittedEvents.at(-1)).toMatchObject({ type: "end", reason: "idle" });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(ImportedSessionStream.isRunning("session-remove-semantics")).toBe(false);
    // Deleted sessions leave the list, so no idle/unread global broadcast events are emitted.
    expect(setSessionStatus).toHaveBeenCalledTimes(0);
  });

  test("finished streams reject late delivery and queue cancellation", async () => {
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finished-mutations", fakeSession);
    stream.finish();

    await expect(stream.deliver(userMessage("late follow-up", "late"))).rejects.toThrow(
      "Session stream finished before the message could be delivered.",
    );
    expect(stream.cancelQueuedMessage("late")).toBe(false);

    expect(stream.getQueuedMessages()).toEqual([]);
  });
});

describe("SessionStream question answers", () => {
  test("answers only the pending request owned by the live canonical state", async () => {
    const sessionId = "session-question-answer";
    cleanUpStreamAfterTest(sessionId);
    onTestFinished(() => deleteSessionState(sessionId));

    let isFirstAnswer = true;
    const handlePendingUserInput = mock(async () => {
      const success = isFirstAnswer;
      isFirstAnswer = false;
      return { success };
    });
    const { session, emitSdkEvent } = makeControllableSession({
      rpc: {
        ui: { handlePendingUserInput },
      },
    });
    const stream = SessionStream.getOrCreate(sessionId, session);

    expect(
      await stream.answerQuestion({
        requestId: "unknown-request",
        answer: "SQLite",
        wasFreeform: false,
      }),
    ).toBe(false);

    emitSdkEvent("tool.execution_start", {
      toolCallId: "question-1",
      toolName: "ask_user",
      arguments: {
        question: "Which database should I use?",
        choices: ["SQLite", "PostgreSQL"],
      },
    });
    emitSdkEvent("user_input.requested", {
      requestId: "request-1",
      toolCallId: "question-1",
      question: "Which database should I use?",
      choices: ["SQLite", "PostgreSQL"],
      allowFreeform: true,
    });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");

    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "SQLite",
        wasFreeform: false,
      }),
    ).toBe(true);
    expect(handlePendingUserInput).toHaveBeenCalledWith({
      requestId: "request-1",
      response: { answer: "SQLite", wasFreeform: false },
    });
    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(handlePendingUserInput).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");

    emitSdkEvent("user_input.completed", {
      requestId: "request-1",
      answer: "SQLite",
      wasFreeform: false,
    });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("running");
    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(handlePendingUserInput).toHaveBeenCalledTimes(2);
  });
});

describe("SessionStream abort", () => {
  test("aborts SDK work and finishes idle after its subscriber disconnects", async () => {
    const sessionId = "session-disconnected-abort";
    cleanUpStreamAfterTest(sessionId, { restoreMocks: true });

    const abortSdk = mock(async () => {});
    const statuses: string[] = [];
    mockStreamRuntimeModules({
      workspace: {
        setSessionStatus: (_sessionId: string, status: string) => statuses.push(status),
      },
    });

    const { SessionStream: ImportedSessionStream } = await import("./index");
    const stream = ImportedSessionStream.getOrCreate(
      sessionId,
      makeFakeSession({ abort: abortSdk }),
    );
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await events.return();
    await stream.abort();

    expect(abortSdk).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["running", "idle"]);
  });

  test("abort clears pending SDK input first and still finishes when abort fails", async () => {
    cleanUpStreamAfterTest("session-abort-failure");

    const calls: string[] = [];
    const fakeSession = makeFakeSession({
      rpc: { queue: { clear: async () => void calls.push("clear") } },
      abort: async () => {
        calls.push("abort");
        throw new Error("abort exploded");
      },
    });

    const stream = SessionStream.getOrCreate("session-abort-failure", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    await expect(stream.abort()).rejects.toThrow("abort exploded");

    expect(calls).toEqual(["clear", "abort"]);
    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual(["end"]);
    expect(SessionStream.isRunning("session-abort-failure")).toBe(false);
  });

  test("abort wins a race with queued-message steering", async () => {
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    const sendMock = mock(async () => "sent");
    const stream = SessionStream.getOrCreate(
      "session-abort-steering-race",
      makeFakeSession({
        send: sendMock,
        rpc: { queue: { clear: () => clearGate } },
      }),
    );
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("queued", "q1"));

    const stopping = stream.abort();
    expect(await stream.steerQueuedMessage("q1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);

    releaseClear();
    await stopping;
    expect(SessionStream.isRunning("session-abort-steering-race")).toBe(false);
  });
});

describe("SessionStream queued messages", () => {
  test("drains the queue on idle: sends, accepts, then finishes when empty", async () => {
    cleanUpStreamAfterTest("session-drain");

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });

    const stream = SessionStream.getOrCreate("session-drain", session);
    await stream.deliver(userMessage("first turn"));
    await stream.deliver(userMessage("second turn", "q1"));
    emitSdkEvent("user.message", { content: "first turn", delivery: "idle" });
    emitSdkEvent("assistant.message", { content: "first response" });

    // First idle: drains the queue into turn 2.
    emitSdkEvent("session.idle");
    await settle();

    expect(sendMock).toHaveBeenCalledWith({ prompt: "second turn", attachments: undefined });
    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "q1", role: "user", content: "second turn" },
    ]);
    expect(
      stream.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect(stream.cancelQueuedMessage("q1")).toBe(false);
    expect(await stream.steerQueuedMessage("q1")).toBe(false);
    expect(SessionStream.isRunning("session-drain")).toBe(true);

    emitSdkEvent("user.message", { content: "second turn", delivery: "idle" });
    expect(stream.getQueuedMessages()).toEqual([]);
    const userMessages = stream
      .getSessionState()
      .messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages.at(-1)).toMatchObject({ content: "second turn" });

    // Second idle with an empty queue finishes the stream.
    emitSdkEvent("session.idle");
    await settle();

    expect(SessionStream.isRunning("session-drain")).toBe(false);
  });

  test("cancelQueuedMessage cancels known ids and rejects unknown ones", async () => {
    cleanUpStreamAfterTest("session-queue-remove");

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-queue-remove", fakeSession);
    await stream.deliver(userMessage("active", "active"));
    await stream.deliver(userMessage("keep me", "q1"));
    await stream.deliver(userMessage("cancel me", "q2"));

    expect(stream.cancelQueuedMessage("missing")).toBe(false);
    expect(stream.cancelQueuedMessage("q2")).toBe(true);
    expect(stream.getQueuedMessages().map((message) => message.clientId)).toEqual(["q1"]);
  });

  test("coalesces equivalent notifications but preserves repeated user messages", async () => {
    cleanUpStreamAfterTest("session-coalesce-direct");

    const fakeSession = makeFakeSession();
    const stream = SessionStream.getOrCreate("session-coalesce-direct", fakeSession);
    await stream.deliver(userMessage("Already running", "active-turn"));

    await stream.deliver(fileEdit("plan.md", "edit-1"));
    await stream.deliver(fileEdit("plan.md", "edit-2"));
    await stream.deliver(fileEdit("other.md", "edit-3"));
    await stream.deliver(userMessage("hello", "u1"));
    await stream.deliver(userMessage("hello", "u2"));

    expect(stream.getQueuedMessages().map((message) => message.clientId)).toEqual([
      "edit-1",
      "edit-3",
      "u1",
      "u2",
    ]);
  });

  test("steering stays queued until the SDK emits its user message", async () => {
    const sessionId = "session-steering";
    cleanUpStreamAfterTest(sessionId);

    let acknowledgeImmediate: (() => void) | undefined;
    const sendMock = mock((options: { mode?: "enqueue" | "immediate" }): Promise<string> => {
      if (options.mode === "immediate") {
        return new Promise((resolve) => {
          acknowledgeImmediate = () => resolve("steered");
        });
      }
      return Promise.resolve("initial");
    });
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });
    const stream = SessionStream.getOrCreate(sessionId, session);

    await stream.deliver(userMessage("same prompt"));
    await stream.deliver(userMessage("same prompt", "q1"));

    const steering = stream.steerQueuedMessage("q1");
    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "q1", role: "user", content: "same prompt", immediate: true },
    ]);
    expect(stream.cancelQueuedMessage("q1")).toBe(false);

    // The original prompt's SDK echo must not consume the pending steer.
    emitSdkEvent("user.message", { content: "same prompt", delivery: "idle" });
    emitSdkEvent("assistant.message", { content: "first response" });
    emitSdkEvent("session.idle");
    await settle();
    expect(sendMock).toHaveBeenCalledTimes(2);

    acknowledgeImmediate?.();
    expect(await steering).toBe(true);

    expect(sendMock).toHaveBeenLastCalledWith({
      prompt: "same prompt",
      attachments: undefined,
      mode: "immediate",
    });
    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "q1", role: "user", content: "same prompt", immediate: true },
    ]);
    expect(
      stream.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);

    emitSdkEvent("user.message", { content: "same prompt", delivery: "queued" });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince().at(-1)).toMatchObject({
      type: "user_message",
      content: "same prompt",
      clientId: "q1",
    });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "user",
      content: "same prompt",
    });
  });

  test("correlates multiple pending steers with SDK user messages in send order", async () => {
    const sessionId = "session-multiple-steering";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async () => "sent");
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });
    const stream = SessionStream.getOrCreate(sessionId, session);

    await stream.deliver(userMessage("opening", "opening-id"));
    emitSdkEvent("user.message", { content: "opening", delivery: "idle" });
    await stream.deliver(userMessage("first steer", "steer-1"));
    await stream.deliver(userMessage("second steer", "steer-2"));

    expect(await stream.steerQueuedMessage("steer-1")).toBe(true);
    expect(await stream.steerQueuedMessage("steer-2")).toBe(true);
    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "steer-1", role: "user", content: "first steer", immediate: true },
      { clientId: "steer-2", role: "user", content: "second steer", immediate: true },
    ]);

    emitSdkEvent("user.message", { content: "canonical first", delivery: "steering" });
    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "steer-2", role: "user", content: "second steer", immediate: true },
    ]);
    expect(stream.getReplayEventsSince().at(-1)).toMatchObject({
      type: "user_message",
      content: "canonical first",
      clientId: "steer-1",
    });

    emitSdkEvent("user.message", { content: "canonical second", delivery: "steering" });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince().at(-1)).toMatchObject({
      type: "user_message",
      content: "canonical second",
      clientId: "steer-2",
    });
  });

  test("correlates queued agent notifications when their SDK input arrives", async () => {
    const sessionId = "session-notification-correlation";
    cleanUpStreamAfterTest(sessionId);

    const { session, emitSdkEvent } = makeControllableSession();
    const stream = SessionStream.getOrCreate(sessionId, session);
    const notificationMessage = fileEdit("plan.md", "notification-1");

    await stream.deliver(userMessage("opening", "opening-id"));
    emitSdkEvent("user.message", { content: "opening", delivery: "idle" });
    await stream.deliver(notificationMessage);
    emitSdkEvent("session.idle");
    await settle();

    expect(stream.getQueuedMessages()).toEqual([notificationMessage]);
    emitSdkEvent("user.message", {
      content: encodeSdkAgentNotification(notificationMessage.notification),
      delivery: "idle",
    });

    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getReplayEventsSince().at(-1)).toMatchObject({
      type: "agent_notification",
      clientId: "notification-1",
      notification: notificationMessage.notification,
    });
  });

  test("steering rejects queued agent notifications", async () => {
    const sessionId = "session-notification-steering";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async () => "sent");
    const stream = SessionStream.getOrCreate(sessionId, makeFakeSession({ send: sendMock }));
    await stream.deliver(userMessage("first turn"));
    await stream.deliver(fileEdit("plan.md", "notification-1"));

    expect(await stream.steerQueuedMessage("notification-1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stream.getQueuedMessages()).toEqual([
      {
        clientId: "notification-1",
        role: "agent_notification",
        notification: {
          type: "file_edited",
          file: { type: "session", sessionId: "notify-session", path: "plan.md" },
        },
      },
    ]);
  });

  test("keeps the message queued when SDK steering acknowledgement fails", async () => {
    const sessionId = "session-steering-failure";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async (options: { mode?: "enqueue" | "immediate" }): Promise<string> => {
      if (options.mode === "immediate") throw new Error("immediate send failed");
      return "initial-message";
    });
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });
    const stream = SessionStream.getOrCreate(sessionId, session);
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("send now", "q1"));

    await expect(stream.steerQueuedMessage("q1")).rejects.toThrow("immediate send failed");
    emitSdkEvent("user.message", { content: "first turn", delivery: "idle" });

    expect(stream.getQueuedMessages()).toEqual([
      { clientId: "q1", role: "user", content: "send now" },
    ]);
    expect(SessionStream.isRunning(sessionId)).toBe(true);
  });

  test("finishes the stream when draining fails to send", async () => {
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
    emitSdkEvent("user.message", { content: "first turn", delivery: "idle" });

    emitSdkEvent("session.idle");
    await settle();

    const drained = await collectStreamEvents(events);
    expect(drained.map((event) => event.type)).toEqual(["message_queued", "user_message", "end"]);
    expect(drained.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-drain-failure")).toBe(false);
  });
});

describe("SessionStream event replay", () => {
  test("internal SDK inputs stay hidden without stealing client correlation", async () => {
    cleanUpStreamAfterTest("session-filtered-input");

    const { session, emitSdkEvent } = makeControllableSession();
    const stream = SessionStream.getOrCreate("session-filtered-input", session);
    await stream.deliver(userMessage("visible prompt", "client-1"));

    emitSdkEvent("user.message", {
      content: "internal skill prompt",
      delivery: "idle",
      source: "skill-plan",
    });
    expect(stream.getReplayEventsSince()).toEqual([]);

    emitSdkEvent("user.message", { content: "visible prompt", delivery: "idle" });
    expect(stream.getReplayEventsSince()).toEqual([
      expect.objectContaining({
        type: "user_message",
        content: "visible prompt",
        clientId: "client-1",
      }),
    ]);
  });

  test("replays canonical events strictly after the cursor", async () => {
    cleanUpStreamAfterTest("session-replay-since");

    const { session, emitSdkEvent } = makeControllableSession();

    const stream = SessionStream.getOrCreate("session-replay-since", session);
    await stream.deliver(userMessage("go"));
    emitSdkEvent("user.message", { content: "go", delivery: "idle" });
    await stream.deliver(userMessage("one", "q1"));
    await stream.deliver(userMessage("two", "q2"));

    const all = stream.getReplayEventsSince();
    expect(all.map((e) => e.type)).toEqual(["user_message", "message_queued", "message_queued"]);

    const afterFirst = stream.getReplayEventsSince(all[0].eventId);
    expect(afterFirst.map((e) => e.type)).toEqual(["message_queued", "message_queued"]);
  });

  test("caps replay history at the retention limit, keeping the newest events", () => {
    cleanUpStreamAfterTest("session-replay-cap");

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
    cleanUpStreamAfterTest("session-event-id-reuse");

    const firstSession = makeControllableSession();
    const first = SessionStream.getOrCreate("session-event-id-reuse", firstSession.session);
    await first.deliver(userMessage("First run"));
    firstSession.emitSdkEvent("user.message", { content: "First run", delivery: "idle" });
    const firstEventId = first.getReplayEventsSince()[0]?.eventId;
    first.finish();

    const secondSession = makeControllableSession();
    const second = SessionStream.getOrCreate("session-event-id-reuse", secondSession.session);
    await second.deliver(userMessage("Second run"));
    secondSession.emitSdkEvent("user.message", { content: "Second run", delivery: "idle" });
    const secondEventId = second.getReplayEventsSince()[0]?.eventId;

    expect(firstEventId).toEqual(expect.any(Number));
    expect(secondEventId).toEqual(expect.any(Number));
    expect(secondEventId!).toBeGreaterThan(firstEventId!);
  });

  test("do not regress after a synchronous burst faster than 1 event/ms", async () => {
    cleanUpStreamAfterTest("session-event-id-burst");

    const { session, emitSdkEvent } = makeControllableSession();

    // A synchronous burst mints ids faster than wall time advances, pushing
    // the last issued id well past Date.now().
    const first = SessionStream.getOrCreate("session-event-id-burst", session);
    await first.deliver(userMessage("burst"));
    for (let i = 0; i < 2000; i++) {
      emitSdkEvent("assistant.message_delta", { deltaContent: `chunk-${i} ` });
    }
    const lastBurstEventId = first.getReplayEventsSince().at(-1)!.eventId!;
    first.finish();

    // A replacement stream for the same session must keep ids increasing, or
    // the client's lastSeenEventId filter would silently drop its events.
    const secondSession = makeControllableSession();
    const second = SessionStream.getOrCreate("session-event-id-burst", secondSession.session);
    await second.deliver(userMessage("after burst"));
    secondSession.emitSdkEvent("user.message", { content: "after burst", delivery: "idle" });

    expect(second.getReplayEventsSince()[0]!.eventId!).toBeGreaterThan(lastBurstEventId);
  });
});

describe("SessionStream model selection", () => {
  test("a turn model emits model_changed into live stream state", async () => {
    cleanUpStreamAfterTest("session-model-change");

    const setModelMock = mock(
      async (_model: string, _options?: { reasoningEffort?: string; contextTier?: string }) => {},
    );
    const fakeSession = makeFakeSession({ setModel: setModelMock });

    const stream = SessionStream.getOrCreate("session-model-change", fakeSession);
    const events = stream.subscribe();

    await stream.deliver({
      clientId: "model-turn",
      role: "user",
      content: "Use this model",
      model: {
        name: "gpt-5.5",
        reasoningEffort: "high",
        contextTier: "future_tier",
      },
    });

    expect(setModelMock).toHaveBeenCalledWith("gpt-5.5", {
      reasoningEffort: "high",
      contextTier: "future_tier",
    });
    expect(stream.getSessionState().model).toEqual({
      name: "gpt-5.5",
      reasoningEffort: "high",
      contextTier: "future_tier",
    });
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({
        type: "model_changed",
        model: {
          name: "gpt-5.5",
          reasoningEffort: "high",
          contextTier: "future_tier",
        },
      }),
    );
    await events.return();
  });
});

describe("streamSession", () => {
  test("reuses the active stream for reconnects without replaying SDK history", async () => {
    cleanUpStreamAfterTest("session-reconnect", { restoreMocks: true });

    const { session, emitSdkEvent } = makeControllableSession();

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-reconnect", session, {
      model: { name: "gpt-5" },
    });
    await stream.deliver(userMessage("Reconnect me", "client-1"));

    const iterator = (await importedStreamSession({ sessionId: "session-reconnect" }))!;
    let receivedCanonicalInput = false;
    const firstEvent = iterator.next().then((result) => {
      receivedCanonicalInput = true;
      return result;
    });
    await settle();
    expect(receivedCanonicalInput).toBe(false);

    emitSdkEvent("user.message", { content: "Reconnect me", delivery: "idle" });
    const first = await firstEvent;
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Reconnect me",
      clientId: "client-1",
    });
  });

  test("stays subscribed when a client prompt queues onto an active stream", async () => {
    cleanUpStreamAfterTest("session-client-delivered-queue", { restoreMocks: true });

    const fakeSession = makeFakeSession();
    const clearDraftPromptMock = mock((_sessionId: string) => {});

    mockStreamRuntimeModules({
      workspace: { clearDraftPrompt: clearDraftPromptMock },
    });

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate("session-client-delivered-queue", fakeSession);
    await stream.deliver(userMessage("Already running"));

    const iterator = (await importedStreamSession({
      sessionId: "session-client-delivered-queue",
      message: { clientId: "queued-client", content: "Queue this client prompt" },
    }))!;
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: { clientId: "queued-client", content: "Queue this client prompt" },
      },
    });
    expect(clearDraftPromptMock).toHaveBeenCalledWith("session-client-delivered-queue");
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({
        clientId: "queued-client",
        role: "user",
        content: "Queue this client prompt",
      }),
    ]);
  });

  test("queues a distinct message even when it carries a location", async () => {
    cleanUpStreamAfterTest("session-distinct-location-message", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules();

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const stream = ImportedSessionStream.getOrCreate(
      "session-distinct-location-message",
      fakeSession,
    );
    await stream.deliver(userMessage("Original message", "original-message"));

    const iterator = (await importedStreamSession({
      sessionId: "session-distinct-location-message",
      message: userMessage("Distinct follow-up", "distinct-message"),
      location: {},
    }))!;
    expect(await iterator.next()).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: { clientId: "distinct-message", content: "Distinct follow-up" },
      },
    });
    await iterator.return?.(undefined);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stream.getQueuedMessages()).toEqual([
      expect.objectContaining({ clientId: "distinct-message", content: "Distinct follow-up" }),
    ]);
  });

  test("clears the draft prompt when a client prompt starts a new stream turn", async () => {
    cleanUpStreamAfterTest("session-client-delivered-start", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });
    const clearDraftPromptMock = mock((_sessionId: string) => {});

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({ session }),
      },
      workspace: { clearDraftPrompt: clearDraftPromptMock },
    });

    const { streamSession: importedStreamSession } = await import("./index");

    const iterator = (await importedStreamSession({
      sessionId: "session-client-delivered-start",
      message: userMessage("Start this client prompt"),
      location: {},
    }))!;
    const firstEvent = iterator.next();
    emitSdkEvent("user.message", { content: "Start this client prompt", delivery: "idle" });
    const first = await firstEvent;
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
    cleanUpStreamAfterTest("session-client-attachment-only", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const { session, emitSdkEvent } = makeControllableSession({ send: sendMock });
    const attachment = {
      displayName: "image.png",
      base64: "aW1hZ2U=",
      mimeType: "image/png",
    };

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({ session }),
      },
    });

    const { streamSession: importedStreamSession } = await import("./index");

    const iterator = (await importedStreamSession({
      sessionId: "session-client-attachment-only",
      message: {
        clientId: "attachment-only",
        content: "",
        attachments: [attachment],
      },
      location: {},
    }))!;
    const firstEvent = iterator.next();
    emitSdkEvent("user.message", {
      content: "",
      delivery: "idle",
      attachments: [
        {
          type: "blob",
          displayName: "image.png",
          data: "aW1hZ2U=",
          mimeType: "image/png",
        },
      ],
    });
    const first = await firstEvent;
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

  test("retries a client follow-up if the active stream finishes before delivery", async () => {
    cleanUpStreamAfterTest("session-client-queue-retry", { restoreMocks: true });

    const activeSession = makeFakeSession();

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const sendMock = mock(async (_message: { prompt: string }) => {
      sdkHandler!({
        type: "user.message",
        data: { content: "Follow-up after finish", delivery: "idle" },
      });
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
      sessionRegistry: {
        withSession: withSessionEvents([]),
        getSession: async () => resumedSession,
      },
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
        stream.finish();
      }

      return originalDeliver(message);
    }) as typeof stream.deliver;

    const events = await collectStreamEvents(
      (await importedStreamSession({
        sessionId: "session-client-queue-retry",
        message: userMessage("Follow-up after finish"),
      }))!,
    );

    expect(closedBeforeDelivery).toBe(true);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Follow-up after finish",
      attachments: undefined,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "user_message", content: "Follow-up after finish" }),
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({ type: "assistant_message", content: "retried response" }),
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
  });

  test("subscribes before sending so short committed responses are delivered", async () => {
    cleanUpStreamAfterTest("session-short-response", { restoreMocks: true });

    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const sendMock = mock(async (_message: { prompt: string }) => {
      sdkHandler!({
        type: "user.message",
        data: { content: "What is France's capital?", delivery: "idle" },
      });
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
      sessionRegistry: {
        withSession: withSessionEvents([]),
        getSession: async () => fakeSession,
      },
    });

    const { streamSession: importedStreamSession } = await import("./index");

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of (await importedStreamSession({
      sessionId: "session-short-response",
      message: userMessage("What is France's capital?"),
    }))!) {
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
    cleanUpStreamAfterTest("session-first-send-failure", { restoreMocks: true });

    const evictMock = mock((_sessionId: string, _error: unknown) => false);
    const fakeSession = makeFakeSession({
      send: async () => {
        throw new Error("send exploded");
      },
    });

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: withSessionEvents([]),
        getSession: async () => fakeSession,
        evictCachedSessionIfStale: evictMock,
      },
    });

    const { SessionStream: ImportedSessionStream, streamSession: importedStreamSession } =
      await import("./index");

    const iterator = (await importedStreamSession({
      sessionId: "session-first-send-failure",
      message: userMessage("doomed prompt"),
    }))!;

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "end", reason: "error" });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(ImportedSessionStream.isRunning("session-first-send-failure")).toBe(false);
    expect(evictMock).toHaveBeenCalledTimes(1);
  });
});

describe("delivery receipts", () => {
  test("returns a queued receipt when the target stream is already live", async () => {
    cleanUpStreamAfterTest("session-delivery-queued");

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
    stream.finish();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("delivers a message immediately into an active stream", async () => {
    cleanUpStreamAfterTest("session-delivery-immediate");

    const sendMock = mock(async () => "sent");
    const { session } = makeControllableSession({ send: sendMock });
    const stream = SessionStream.getOrCreate("session-delivery-immediate", session);
    await stream.deliver(userMessage("Already running", "opening"));

    const receipt = await deliverSessionMessage(
      "session-delivery-immediate",
      userMessage("Send this now", "immediate"),
      { immediate: true },
    );

    expect(receipt.disposition).toBe("queued");
    expect(sendMock).toHaveBeenLastCalledWith({
      prompt: "Send this now",
      attachments: undefined,
      mode: "immediate",
    });
    expect(stream.getQueuedMessages()).toEqual([
      {
        clientId: "immediate",
        role: "user",
        content: "Send this now",
        immediate: true,
      },
    ]);
  });

  test("returns a started receipt when the message opens an idle session turn", async () => {
    cleanUpStreamAfterTest("session-delivery-sent", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: withSessionEvents([]),
        getSession: async () => fakeSession,
      },
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
    finishStream("session-delivery-sent");
    await expect(completion).resolves.toEqual({ status: "completed" });
  });
});

describe("createSession", () => {
  test("creates the session and starts its first message as one operation", async () => {
    cleanUpStreamAfterTest("session-headless-create", { restoreMocks: true });

    const calls: string[] = [];
    const sendMock = mock(async (_message: { prompt: string }) => {
      calls.push("send");
    });
    const fakeSession = makeFakeSession({ send: sendMock });
    const createSessionMock = mock(
      async (_sessionId: string, _options: Record<string, unknown>) => {
        calls.push("create");
        return { session: fakeSession };
      },
    );
    const setSessionStatus = mock((_sessionId: string, status: string) => {
      calls.push(status);
    });

    mockStreamRuntimeModules({
      sessionRegistry: { createSession: createSessionMock },
      workspace: { setSessionStatus },
    });

    const { createSession: importedCreate } = await import("./index");
    const receipt = await importedCreate(
      "session-headless-create",
      {
        clientId: "first-message",
        content: "Start in the background",
        model: { name: "gpt-5.5", reasoningEffort: "high" },
      },
      {
        directory: "/repo",
        useWorktree: true,
        worker: {
          type: "file",
          sessionId: "session-headless-create",
          ephemeral: true,
          file: { type: "session", sessionId: "parent-session", path: "report.md" },
        },
        initialContext: { workingDirectory: "/repo" },
        sessionType: "worker",
        name: "Background task",
      },
    );

    expect(receipt.disposition).toBe("started");
    expect(createSessionMock).toHaveBeenCalledWith("session-headless-create", {
      model: { name: "gpt-5.5", reasoningEffort: "high" },
      directory: "/repo",
      useWorktree: true,
      worker: {
        type: "file",
        sessionId: "session-headless-create",
        ephemeral: true,
        file: { type: "session", sessionId: "parent-session", path: "report.md" },
      },
      initialContext: { workingDirectory: "/repo" },
      sessionType: "worker",
      name: "Background task",
    });
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start in the background",
      attachments: undefined,
    });
    expect(calls).toEqual(["create", "running", "send"]);
  });

  test("seeds an artifact-backed draft into the live session", async () => {
    const sessionId = "session-artifact-draft";
    cleanUpStreamAfterTest(sessionId, { restoreMocks: true });
    const fakeSession = makeFakeSession();

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({ session: fakeSession, artifactPath: "document.md" }),
      },
    });

    const { createSession: importedCreate, SessionStream: ImportedSessionStream } =
      await import("./index");
    await importedCreate(sessionId, userMessage("Update the document"), {});

    expect(ImportedSessionStream.get(sessionId)?.getSessionState().artifacts).toEqual([
      "document.md",
    ]);
  });
});

describe("deliverSessionMessage", () => {
  test("starts an idle historical session immediately", async () => {
    cleanUpStreamAfterTest("session-start-helper", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: withSessionEvents([]),
        getSession: async () => fakeSession,
      },
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver("session-start-helper", {
      clientId: "start-helper",
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
    cleanUpStreamAfterTest("session-snapshot-seed", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: async () => {
          throw new Error("snapshot-seeded streams must not fetch history");
        },
        getSession: async () => fakeSession,
      },
      snapshotCache: {
        getCachedSnapshot: async () =>
          idleSnapshot("session-snapshot-seed", [
            { role: "user", content: "earlier prompt" },
            { role: "assistant", content: "earlier answer" },
          ]),
      },
    });

    const { deliverSessionMessage: importedDeliver, SessionStream: ImportedSessionStream } =
      await import("./index");

    await importedDeliver("session-snapshot-seed", userMessage("follow-up question"));

    const stream = ImportedSessionStream.get("session-snapshot-seed");
    expect(stream).toBeDefined();
    expect(
      stream!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer"]);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "follow-up question",
      attachments: undefined,
    });
  });

  test("retries once when a snapshot-seeded send hits a stale cached handle", async () => {
    cleanUpStreamAfterTest("session-snapshot-stale", { restoreMocks: true });

    const staleSend = mock(async () => {
      throw new Error("Session not found: session-snapshot-stale");
    });
    const freshSend = mock(async (_message: { prompt: string }) => {});
    const staleSession = makeFakeSession({ send: staleSend });
    const freshSession = makeFakeSession({ send: freshSend });

    // First resume returns the stale cached handle; after eviction the next
    // resume is fresh.
    let resumeCount = 0;
    mockStreamRuntimeModules({
      sessionRegistry: {
        getSession: async () => (resumeCount++ === 0 ? staleSession : freshSession),
        evictCachedSessionIfStale: (_sessionId: string, error: unknown) =>
          error instanceof Error && error.message.toLowerCase().includes("session not found"),
      },
      snapshotCache: {
        getCachedSnapshot: async () =>
          idleSnapshot("session-snapshot-stale", [
            { role: "user", content: "earlier prompt" },
            { role: "assistant", content: "earlier answer" },
          ]),
      },
    });

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
    ).toEqual(["earlier prompt", "earlier answer"]);
  });
});

describe("single-flight stream acquisition", () => {
  test("concurrent background sends share one acquisition: creator sends, joiner queues", async () => {
    cleanUpStreamAfterTest("session-single-flight", { restoreMocks: true });

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
      sessionRegistry: {
        withSession: withSessionMock,
        getSession: async () => fakeSession,
      },
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
    cleanUpStreamAfterTest("session-client-join", { restoreMocks: true });

    const sendMock = mock(async (_message: { prompt: string }) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    let releaseResume!: () => void;
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: async <T>(
          _sessionId: string,
          operation: (session: CopilotSession) => Promise<T>,
        ) => {
          await resumeGate;
          return operation({ getEvents: async () => [] } as unknown as CopilotSession);
        },
        getSession: async () => fakeSession,
      },
    });

    const {
      deliverSessionMessage: importedDeliver,
      streamSession: importedStreamSession,
      SessionStream: ImportedSessionStream,
    } = await import("./index");

    // Background sender enters the acquisition window first...
    const background = importedDeliver("session-client-join", userMessage("background prompt"));
    // ...then a client prompt races in; it must join, not double-send.
    const clientSubscription = importedStreamSession({
      sessionId: "session-client-join",
      message: userMessage("client prompt"),
    });
    const clientNext = clientSubscription.then((subscription) => subscription!.next());

    releaseResume();
    await background;
    const clientResult = await clientNext;

    // The connected joiner immediately sees its shared queue update; the
    // background input remains SDK-authoritative.
    expect(clientResult).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: expect.objectContaining({ role: "user", content: "client prompt" }),
      },
    });
    const clientIterator = (await clientSubscription)!;
    await clientIterator.return?.(undefined);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ prompt: "background prompt", attachments: undefined });
    const stream = ImportedSessionStream.get("session-client-join");
    expect(stream!.getQueuedMessages()).toEqual([
      expect.objectContaining({ role: "user", content: "client prompt" }),
    ]);
  });
});

describe("rewindSession", () => {
  test("resolves the message timestamp and publishes the refreshed snapshot after rewind", async () => {
    restoreMocksAfterTest();

    const rewind = mock(async () => ({
      outcome: "success" as const,
      eventsRemoved: 5,
      restoredFiles: [],
      skippedFiles: [],
    }));
    const listRewindPoints = mock(async () => ({
      fileChangeTrackingEnabled: false,
      points: [
        { eventId: "event-a", timestamp: "2026-08-14T19:00:00.000Z" },
        { eventId: "event-b", timestamp: "2026-08-14T20:00:00.000Z" },
      ],
    }));
    const snapshot = idleSnapshot("session-rewind", [{ role: "user", content: "retained" }]);
    const refreshSessionSnapshot = mock(async () => snapshot);
    const emitSessionTouched = mock((_sessionId: string) => {});
    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: async <T>(
          _sessionId: string,
          operation: (session: CopilotSession) => Promise<T>,
        ) =>
          operation({
            rpc: { history: { listRewindPoints, rewind } },
          } as unknown as CopilotSession),
      },
      snapshotCache: { refreshSessionSnapshot },
      broadcast: { emitSessionTouched },
    });
    const { rewindSession: importedRewindSession } = await import("./index");

    await expect(
      importedRewindSession("session-rewind", "2026-08-14T20:00:00.000Z"),
    ).resolves.toEqual(snapshot);
    expect(rewind).toHaveBeenCalledWith({ eventId: "event-b", mode: "conversation" });
    expect(emitSessionTouched).toHaveBeenCalledWith("session-rewind");
  });
});

describe("SessionStream.waitForCompletion", () => {
  test("answers from a cached snapshot without fetching history when no stream is running", async () => {
    restoreMocksAfterTest();

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: async () => {
          throw new Error("waitForCompletion with a cached snapshot must not fetch history");
        },
      },
      snapshotCache: {
        getCachedSnapshot: async () =>
          idleSnapshot("session-snapshot-wait", [
            { role: "user", content: "do the thing" },
            { role: "assistant", content: "Cached result" },
          ]),
      },
    });
    const { SessionStream: ImportedSessionStream } = await import("./index");

    await expect(ImportedSessionStream.waitForCompletion("session-snapshot-wait")).resolves.toEqual(
      { status: "completed", response: "Cached result" },
    );
  });

  test("falls back to persisted history when no stream is running for the session", async () => {
    restoreMocksAfterTest();

    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: withSessionEvents([
          {
            id: "persisted-event",
            parentId: "persisted-parent",
            timestamp: "2026-01-01T00:00:00.000Z",
            type: "assistant.message",
            data: { messageId: "persisted-message", content: "Persisted result" },
          },
        ]),
      },
    });
    const { SessionStream: ImportedSessionStream } = await import("./index");
    await expect(ImportedSessionStream.waitForCompletion("session-not-running")).resolves.toEqual({
      status: "completed",
      response: "Persisted result",
    });
  });

  test("caches the snapshot it replays so the next read is warm", async () => {
    restoreMocksAfterTest();

    const cacheSnapshotMock = mock((_sessionId: string, _snapshot: unknown) => {});
    mockStreamRuntimeModules({
      sessionRegistry: {
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
      snapshotCache: { cacheSnapshot: cacheSnapshotMock },
    });
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

  test("resolves when the current stream finishes", async () => {
    cleanUpStreamAfterTest("session-finish-wait", { restoreMocks: true });

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finish-wait", fakeSession);
    const waitPromise = stream.waitForCompletion();

    stream.finish();

    await expect(waitPromise).resolves.toEqual({ status: "completed" });
  });

  test("returns timed-out status with the latest reduced assistant response", async () => {
    cleanUpStreamAfterTest("session-timeout", { restoreMocks: true });

    const stream = createStreamWithAssistantResponse("session-timeout", "Partial result");

    await expect(stream.waitForCompletion(1)).resolves.toEqual({
      status: "timed_out",
      response: "Partial result",
    });
    expect(SessionStream.get("session-timeout")).toBe(stream);
  });

  test("returns failed status with the latest real assistant response", async () => {
    cleanUpStreamAfterTest("session-error-completion", { restoreMocks: true });

    const stream = createStreamWithAssistantResponse("session-error-completion", "Partial result");
    const waitPromise = stream.waitForCompletion();

    stream.finish("error");

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
    cleanUpStreamAfterTest("session-delete-wait", { restoreMocks: true });

    const stream = createStreamWithAssistantResponse("session-delete-wait", "Deleted result");
    const waitPromise = stream.waitForCompletion();

    SessionStream.remove("session-delete-wait");

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "Deleted result",
    });
  });

  test("waits for the captured stream instance, not a future replacement", async () => {
    cleanUpStreamAfterTest("session-replaced", { restoreMocks: true });

    const first = createStreamWithAssistantResponse("session-replaced", "First result");
    const waitPromise = first.waitForCompletion();

    first.finish();
    const second = SessionStream.getOrCreate("session-replaced", makeFakeSession());

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "First result",
    });
    expect(SessionStream.get("session-replaced")).toBe(second);
  });
});

describe("waitForSession", () => {
  test("waits for a session announced before its live stream exists", async () => {
    const receipt = registerPendingSessionCompletion("session-pending-wait");
    const first = waitForSession("session-pending-wait");

    expect(waitForSession("session-pending-wait")).toBe(first);
    receipt.resolve({ status: "completed", response: "Pending result" });

    await expect(first).resolves.toEqual({ status: "completed", response: "Pending result" });
  });

  test("times out one waiter without settling the announced session", async () => {
    const receipt = registerPendingSessionCompletion("session-pending-timeout");

    await expect(waitForSession("session-pending-timeout", 1)).resolves.toEqual({
      status: "timed_out",
    });

    const completion = waitForSession("session-pending-timeout");
    receipt.resolve({ status: "completed", response: "Finished later" });
    await expect(completion).resolves.toEqual({
      status: "completed",
      response: "Finished later",
    });
  });

  test("rejects waiters when an announced session is canceled", async () => {
    registerPendingSessionCompletion("session-pending-canceled");
    const completion = waitForSession("session-pending-canceled");
    const error = new Error("Canceled");

    expect(rejectPendingSessionCompletion("session-pending-canceled", error)).toBe(true);
    await expect(completion).rejects.toBe(error);
    expect(rejectPendingSessionCompletion("session-pending-canceled", error)).toBe(false);
  });
});
