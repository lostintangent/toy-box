import type { SessionConnection } from "@providers/server/provider";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import {
  createSession,
  deliverSessionMessage,
  getSessionRuntimeStatus,
  getSessionSnapshot,
  registerPendingSessionCompletion,
  rejectPendingSessionCompletion,
  rewindSession,
  streamSession,
  waitForSessions,
} from "./index";
import { SessionStream } from "./sessionStream";
import { deleteSessionFiles, writeSessionArtifact } from "../artifacts";
import * as realSessionRegistry from "@sessions/server/state/registry";
import * as realSnapshotCache from "@sessions/server/state/snapshots";
import * as realWorkspaceState from "@workspace/server/state";
import {
  deleteSessionState,
  getSessionState as getWorkspaceSessionState,
} from "@workspace/server/state/sessions";
import * as realBroadcast from "@workspace/server/events";
import type { SessionEvent, SessionMessage, SessionState } from "@sessions/model";
import { createInitialSessionState } from "@sessions/model/reducer";

const realSessionRegistryExports = { ...realSessionRegistry };
const realSnapshotCacheExports = { ...realSnapshotCache };
const realWorkspaceStateExports = { ...realWorkspaceState };
const realBroadcastExports = { ...realBroadcast };

function userMessage(
  content: string,
  clientId: string = crypto.randomUUID(),
): Extract<SessionMessage, { role: "user" }> {
  return { clientId, role: "user", content };
}

function fileEdit(
  path: string,
  clientId: string = crypto.randomUUID(),
): Extract<SessionMessage, { role: "system" }> {
  return {
    clientId,
    role: "system",
    content: {
      type: "file_edited",
      file: { kind: "session", sessionId: "notify-session", path },
    },
  };
}

function cleanUpStreamAfterTest(sessionId: string): void {
  onTestFinished(() => {
    SessionStream.get(sessionId)?.finish();
    realSnapshotCacheExports.evictCachedSnapshot(sessionId);
    deleteSessionState(sessionId);
  });
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

/** A provider connection with inert operations unless the test supplies behavior. */
function makeFakeSession(overrides: Partial<SessionConnection> = {}): SessionConnection {
  return {
    provider: { id: "test", sessionId: "test" },
    onEvent: () => () => {},
    send: async () => {},
    setModel: async () => {},
    answerQuestion: async () => false,
    abort: async () => {},
    disconnect: async () => {},
    rename: async () => true,
    rewind: async () => {},
    ...overrides,
  };
}

function createStreamWithAssistantResponse(sessionId: string, response: string): SessionStream {
  return SessionStream.getOrCreate(sessionId, makeFakeSession(), {
    messages: [{ role: "assistant", content: response }],
  });
}

/** Emit canonical events synchronously; settle() lets async queue draining finish. */
function makeControllableSession(overrides: Partial<SessionConnection> = {}) {
  let listener!: (event: SessionEvent) => void;
  const session = makeFakeSession({
    ...overrides,
    onEvent: (handler) => {
      listener = handler;
      return () => {};
    },
  });
  return { session, emit: (event: SessionEvent) => listener(event) };
}

/** Let the runtime's floating continuations settle before asserting. */
const settle = () => Bun.sleep(0);

type StreamRuntimeModuleMocks = {
  sessionRegistry?: Partial<typeof realSessionRegistry>;
  snapshotCache?: Partial<typeof realSnapshotCache>;
  broadcast?: Partial<typeof realBroadcast>;
  workspace?: Partial<typeof realWorkspaceState>;
};

/** Mock the runtime modules SessionStream imports so tests can drive streams with
 *  provider connections. Callers override the sessionRegistry and snapshotCache
 *  behavior they need; the defaults fail loudly if an unexpected path is
 *  taken, and the default snapshot cache is always empty. */
function mockStreamRuntimeModules({
  sessionRegistry: sessionRegistryOverrides = {},
  snapshotCache: snapshotCacheOverrides = {},
  broadcast: broadcastOverrides = {},
  workspace: workspaceOverrides = {},
}: StreamRuntimeModuleMocks = {}) {
  // mock.restore() does not undo module replacements.
  onTestFinished(() => {
    mock.module("@sessions/server/state/registry", () => realSessionRegistryExports);
    mock.module("@sessions/server/state/snapshots", () => realSnapshotCacheExports);
    mock.module("@workspace/server/state", () => realWorkspaceStateExports);
    mock.module("@workspace/server/events", () => realBroadcastExports);
  });
  mock.module("@sessions/server/state/registry", () => ({
    ...realSessionRegistryExports,
    createSession: async () => {
      throw new Error("createSession mock was not provided");
    },
    acquireSession: async () => {
      throw new Error("acquireSession mock was not provided");
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
    releaseSession: () => {},
    ...sessionRegistryOverrides,
  }));
  mock.module("@sessions/server/state/snapshots", () => ({
    ...realSnapshotCacheExports,
    getCachedSnapshot: async () => undefined,
    cacheSnapshot: () => {},
    evictCachedSnapshot: () => {},
    loadSessionSnapshot: async () => createInitialSessionState(),
    ...snapshotCacheOverrides,
  }));
  mock.module("@workspace/server/state", () => ({
    ...realWorkspaceStateExports,
    setSessionStatus: () => {},
    ...workspaceOverrides,
  }));
  mock.module("@workspace/server/events", () => ({
    ...realBroadcastExports,
    broadcast: () => {},
    ...broadcastOverrides,
  }));
}

describe("SessionStream lifecycle", () => {
  test("title events update workspace metadata without entering the session stream", async () => {
    const sessionId = "session-shared-title";
    cleanUpStreamAfterTest(sessionId);
    const broadcast = mock();
    mockStreamRuntimeModules({ broadcast: { broadcast } });
    const { session, emit } = makeControllableSession();
    const stream = SessionStream.getOrCreate(sessionId, session);
    const received = collectStreamEvents(stream.subscribe());
    await stream.deliver(userMessage("go"));

    emit({ type: "session_title_changed", title: "Shared title" });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: "session.upserted",
      session: { id: sessionId, title: "Shared title" },
    });

    stream.finish();
    expect((await received).filter((event) => event.type === "session_title_changed")).toEqual([]);
  });

  test("finish clears the queue, signals end-of-stream, and deregisters", async () => {
    cleanUpStreamAfterTest("session-finish-semantics");
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finish-semantics", fakeSession);
    const events = stream.subscribe();

    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
    stream.finish();

    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "status",
      "message_queued",
      "end",
    ]);
    expect(stream.getSessionState().queuedMessages).toEqual([]);
    expect(SessionStream.isRunning("session-finish-semantics")).toBe(false);
  });

  test("caches the canonical final state before publishing terminal status", async () => {
    const sessionId = "session-finish-cache";
    cleanUpStreamAfterTest(sessionId);

    const transitions: string[] = [];
    const cacheSnapshot = mock((_sessionId: string, snapshot: SessionState) => {
      transitions.push(`cache:${snapshot.status}`);
    });
    const setSessionStatus = mock((_sessionId: string, status: string) => {
      transitions.push(`status:${status}`);
    });
    mockStreamRuntimeModules({
      snapshotCache: { cacheSnapshot },
      workspace: { setSessionStatus },
    });

    const stream = SessionStream.getOrCreate(sessionId, makeFakeSession());
    const subscription = stream.subscribe();
    await stream.deliver(userMessage("go"));
    transitions.length = 0;

    stream.finish();

    const events = await collectStreamEvents(subscription);
    expect(events.map((event) => event.type)).toEqual(["status", "end"]);
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
    cleanUpStreamAfterTest("session-abort-no-cache");
    cleanUpStreamAfterTest("session-error-no-cache");

    const cacheSnapshot = mock((_sessionId: string, _snapshot: SessionState) => {});
    mockStreamRuntimeModules({ snapshotCache: { cacheSnapshot } });

    const aborted = SessionStream.getOrCreate("session-abort-no-cache", makeFakeSession());
    await aborted.deliver(userMessage("abort"));
    await aborted.abort();

    const failed = SessionStream.getOrCreate("session-error-no-cache", makeFakeSession());
    await failed.deliver(userMessage("fail"));
    failed.finish("error");

    expect(cacheSnapshot).toHaveBeenCalledTimes(0);
  });

  test("preserves the provider error in the terminal event and transcript", async () => {
    cleanUpStreamAfterTest("session-provider-error");

    const { session, emit } = makeControllableSession();

    const stream = SessionStream.getOrCreate("session-provider-error", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    const error = "You've hit your usage limit.";
    emit({ type: "end", reason: "error", error });

    const emitted = await collectStreamEvents(events);
    expect(emitted.map((event) => event.type)).toEqual(["status", "end"]);
    expect(emitted.at(-1)).toMatchObject({
      type: "end",
      reason: "error",
      error,
    });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      error,
    });
    expect(SessionStream.isRunning("session-provider-error")).toBe(false);
  });

  test("marks a completed stream unread after its client disconnects", async () => {
    const sessionId = "session-disconnected-unread";
    cleanUpStreamAfterTest(sessionId);

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const stream = SessionStream.getOrCreate(sessionId, makeFakeSession());
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
    cleanUpStreamAfterTest(activeSessionId);
    cleanUpStreamAfterTest(passiveSessionId);

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const activeStream = SessionStream.getOrCreate(activeSessionId, makeFakeSession());
    const activeEvents = activeStream.subscribe();
    await activeStream.deliver(userMessage("go"));
    activeStream.finish();
    await activeEvents.return();

    const passiveStream = SessionStream.getOrCreate(passiveSessionId, makeFakeSession());
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
    cleanUpStreamAfterTest("session-remove-semantics");

    const setSessionStatus = mock((_sessionId: string, _status: string) => {});
    mockStreamRuntimeModules({ workspace: { setSessionStatus } });

    const abort = mock(async () => {});
    const fakeSession = makeFakeSession({ abort });

    const stream = SessionStream.getOrCreate("session-remove-semantics", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await stream.deliver(userMessage("queued"));
    setSessionStatus.mockClear();

    await SessionStream.remove("session-remove-semantics");

    const emittedEvents = await collectStreamEvents(events);
    expect(emittedEvents.map((event) => event.type)).toEqual(["status", "message_queued", "end"]);
    expect(emittedEvents.at(-1)).toMatchObject({ type: "end", reason: "idle" });
    expect(stream.getSessionState().queuedMessages).toEqual([]);
    expect(SessionStream.isRunning("session-remove-semantics")).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
    // Deleted sessions leave the list, so no idle/unread global broadcast events are emitted.
    expect(setSessionStatus).toHaveBeenCalledTimes(0);
  });

  test("finished streams reject late delivery and queue cancellation", async () => {
    cleanUpStreamAfterTest("session-finished-mutations");
    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finished-mutations", fakeSession);
    stream.finish();

    await expect(stream.deliver(userMessage("late follow-up", "late"))).rejects.toThrow(
      "Session stream finished before the message could be delivered.",
    );
    expect(stream.cancelQueuedMessage("late")).toBe(false);

    expect(stream.getSessionState().queuedMessages).toEqual([]);
  });
});

test("artifact refresh reconciles both clients and ignores updates after execution ends", async () => {
  const sessionId = "session-observed-artifacts";
  cleanUpStreamAfterTest(sessionId);
  const stream = SessionStream.getOrCreate(sessionId, makeFakeSession(), {
    artifacts: [{ path: "deleted.md", updatedAt: 1 }],
  });
  const first = stream.subscribe();
  const second = stream.subscribe();
  const created = { path: "created.html", updatedAt: 2 };

  stream.updateArtifacts([created]);
  const event = await nextStreamEvent(first);
  expect(event).toMatchObject({ type: "artifacts_changed", artifacts: [created] });
  expect(await nextStreamEvent(second)).toEqual(event);

  stream.finish();
  stream.updateArtifacts([{ path: "after-finish.md", updatedAt: 3 }]);
  expect(stream.getSessionState().artifacts).toEqual([created]);
});

describe("SessionStream question answers", () => {
  test("answers only the pending request owned by the live canonical state", async () => {
    const sessionId = "session-question-answer";
    cleanUpStreamAfterTest(sessionId);

    let isFirstAnswer = true;
    const answerQuestion = mock(async () => {
      const success = isFirstAnswer;
      isFirstAnswer = false;
      return success;
    });
    const { session, emit } = makeControllableSession({
      answerQuestion,
    });
    const stream = SessionStream.getOrCreate(sessionId, session);

    expect(
      await stream.answerQuestion({
        requestId: "unknown-request",
        answer: "SQLite",
        wasFreeform: false,
      }),
    ).toBe(false);

    emit({
      type: "tool_start",
      toolCallId: "question-1",
      toolName: "ask_user",
      arguments: {
        question: "Which database should I use?",
        choices: ["SQLite", "PostgreSQL"],
      },
    });
    emit({
      type: "question_requested",
      toolCallId: "question-1",
      requestId: "request-1",
      question: {
        question: "Which database should I use?",
        choices: ["SQLite", "PostgreSQL"],
        allowFreeform: true,
      },
    });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");

    emit({ type: "status", status: "reasoning" });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");
    emit({ type: "status", status: "background" });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");

    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "SQLite",
        wasFreeform: false,
      }),
    ).toBe(true);
    expect(answerQuestion).toHaveBeenCalledWith({
      requestId: "request-1",
      answer: "SQLite",
      wasFreeform: false,
    });
    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(answerQuestion).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("waiting");

    emit({ type: "question_resolved", toolCallId: "question-1", answer: "SQLite" });
    expect(getWorkspaceSessionState(sessionId)?.status).toBe("running");
    expect(
      await stream.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(answerQuestion).toHaveBeenCalledTimes(2);
  });
});

describe("SessionStream abort", () => {
  test("aborts provider work and finishes idle after its subscriber disconnects", async () => {
    const sessionId = "session-disconnected-abort";
    cleanUpStreamAfterTest(sessionId);

    const abortProvider = mock(async () => {});
    const statuses: string[] = [];
    mockStreamRuntimeModules({
      workspace: {
        setSessionStatus: (_sessionId: string, status: string) => statuses.push(status),
      },
    });

    const stream = SessionStream.getOrCreate(sessionId, makeFakeSession({ abort: abortProvider }));
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));
    await events.return();
    await stream.abort();

    expect(abortProvider).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["running", "idle"]);
  });

  test("finishes even when the provider abort fails", async () => {
    cleanUpStreamAfterTest("session-abort-failure");

    const calls: string[] = [];
    const fakeSession = makeFakeSession({
      abort: async () => {
        calls.push("abort");
        throw new Error("abort exploded");
      },
    });

    const stream = SessionStream.getOrCreate("session-abort-failure", fakeSession);
    const events = stream.subscribe();
    await stream.deliver(userMessage("go"));

    await expect(stream.abort()).rejects.toThrow("abort exploded");

    expect(calls).toEqual(["abort"]);
    expect((await collectStreamEvents(events)).map((event) => event.type)).toEqual([
      "status",
      "end",
    ]);
    expect(SessionStream.isRunning("session-abort-failure")).toBe(false);
  });

  test("abort wins a race with queued-message steering", async () => {
    cleanUpStreamAfterTest("session-abort-steering-race");
    const abortGate = Promise.withResolvers<void>();
    const sendMock = mock(async () => {});
    const stream = SessionStream.getOrCreate(
      "session-abort-steering-race",
      makeFakeSession({
        send: sendMock,
        abort: () => abortGate.promise,
      }),
    );
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("queued", "q1"));

    const stopping = stream.abort();
    expect(await stream.steerQueuedMessage("q1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);

    abortGate.resolve();
    await stopping;
    expect(SessionStream.isRunning("session-abort-steering-race")).toBe(false);
  });
});

describe("SessionStream queued messages", () => {
  test.each(["before", "after"] as const)(
    "dispatches messages queued %s background readiness without completing the runtime",
    async (when) => {
      const sessionId = `session-background-${when}`;
      cleanUpStreamAfterTest(sessionId);
      const send = mock(async (_message: SessionMessage) => {});
      const { session, emit } = makeControllableSession({ send });
      const stream = SessionStream.getOrCreate(sessionId, session);
      await stream.deliver(userMessage("First", "first"));
      if (when === "before") await stream.deliver(userMessage("Next", "next"));
      emit({ type: "status", status: "background" });
      if (when === "after") await stream.deliver(userMessage("Next", "next"));
      emit({ type: "status", status: "background" });
      emit({ type: "end", reason: "idle" });
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
      expect(SessionStream.isRunning(sessionId)).toBe(true);

      emit({ type: "status", status: "thinking" });
      expect(getWorkspaceSessionState(sessionId)?.status).toBe("running");
      emit({ type: "user_message", content: "Next", clientId: "next" });
      emit({ type: "status", status: "background" });
      emit({ type: "status", status: "background" });
      expect(getWorkspaceSessionState(sessionId)?.status).toBe("background");
      expect(stream.getSessionState().queuedMessages).toEqual([]);
      expect((await stream.waitForCompletion(0)).status).toBe("timed_out");
      expect(SessionStream.isRunning(sessionId)).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);

      emit({ type: "end", reason: "idle" });
      expect(SessionStream.isRunning(sessionId)).toBe(false);
    },
  );

  test("an immediate message queues normally while another queued message is being sent", async () => {
    const sessionId = "session-provider-busy-submission";
    cleanUpStreamAfterTest(sessionId);
    const submission = Promise.withResolvers<void>();
    const sent: SessionMessage[] = [];
    const { session, emit } = makeControllableSession({
      send: async (message: SessionMessage) => {
        sent.push(message);
        if (message.clientId === "second") await submission.promise;
      },
    });
    const stream = SessionStream.getOrCreate(sessionId, session);
    await stream.deliver(userMessage("First", "first"));
    await stream.deliver(userMessage("Second", "second"));
    emit({
      type: "user_message",
      content: "First",
      clientId: "first",
      timestamp: "2026-09-14T00:00:00Z",
    });
    emit({ type: "end", reason: "idle" });
    expect(sent.map(({ clientId }) => clientId)).toEqual(["first", "second"]);
    expect(await stream.deliver({ ...userMessage("Third", "third"), immediate: true })).toBe(
      "queued",
    );
    expect(sent).toHaveLength(2);
    expect(
      stream.getSessionState().queuedMessages.find(({ clientId }) => clientId === "third")
        ?.immediate,
    ).toBeUndefined();
    expect(stream.cancelQueuedMessage("second")).toBe(false);

    emit({
      type: "user_message",
      content: "Second",
      clientId: "second",
      timestamp: "2026-09-14T00:00:01Z",
    });
    submission.resolve();
    await settle();
    emit({ type: "end", reason: "idle" });
    await settle();
    expect(sent.map(({ clientId }) => clientId)).toEqual(["first", "second", "third"]);
  });

  test("drains the queue on idle: sends, accepts, then finishes when empty", async () => {
    cleanUpStreamAfterTest("session-drain");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const stream = SessionStream.getOrCreate("session-drain", session);
    const received = collectStreamEvents(stream.subscribe());
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("second turn", "q1"));
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });
    emit({ type: "assistant_message", content: "first response" });

    // First idle: drains the queue into turn 2.
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "second turn" }),
    );
    expect(stream.getSessionState().queuedMessages).toEqual([
      { clientId: "q1", role: "user", content: "second turn", status: "submitted" },
    ]);
    expect(
      stream.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect(stream.cancelQueuedMessage("q1")).toBe(false);
    expect(await stream.steerQueuedMessage("q1")).toBe(false);
    expect(SessionStream.isRunning("session-drain")).toBe(true);

    emit({ type: "user_message", content: "second turn", clientId: "q1" });
    expect(stream.getSessionState().queuedMessages).toEqual([]);
    const userMessages = stream
      .getSessionState()
      .messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages.at(-1)).toMatchObject({ content: "second turn" });

    // Second idle with an empty queue finishes the stream.
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(SessionStream.isRunning("session-drain")).toBe(false);
    expect((await received).filter((event) => event.type === "end")).toMatchObject([
      { type: "end", reason: "idle" },
    ]);
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
    expect(stream.getSessionState().queuedMessages.map((message) => message.clientId)).toEqual([
      "q1",
    ]);
  });

  test("coalesces equivalent system messages but preserves repeated user messages", async () => {
    cleanUpStreamAfterTest("session-coalesce-direct");

    const fakeSession = makeFakeSession();
    const stream = SessionStream.getOrCreate("session-coalesce-direct", fakeSession);
    await stream.deliver(userMessage("Already running", "active-turn"));

    await stream.deliver(fileEdit("plan.md", "edit-1"));
    await stream.deliver(fileEdit("plan.md", "edit-2"));
    await stream.deliver(fileEdit("other.md", "edit-3"));
    await stream.deliver(userMessage("hello", "u1"));
    await stream.deliver(userMessage("hello", "u2"));

    expect(stream.getSessionState().queuedMessages.map((message) => message.clientId)).toEqual([
      "edit-1",
      "edit-3",
      "u1",
      "u2",
    ]);
  });

  test("steering stays queued until the provider echoes its user message", async () => {
    const sessionId = "session-steering";
    cleanUpStreamAfterTest(sessionId);

    const acknowledged = Promise.withResolvers<void>();
    const sendMock = mock(async (message: SessionMessage) => {
      if (message.immediate) await acknowledged.promise;
    });
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const stream = SessionStream.getOrCreate(sessionId, session);

    await stream.deliver(userMessage("same prompt", "opening-id"));
    await stream.deliver(userMessage("same prompt", "q1"));

    const steering = stream.steerQueuedMessage("q1");
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "q1",
        role: "user",
        content: "same prompt",
        immediate: true,
        status: "submitting",
      },
    ]);
    expect(stream.cancelQueuedMessage("q1")).toBe(false);

    // The original prompt's provider echo must not consume the pending steer.
    emit({ type: "user_message", content: "same prompt", clientId: "opening-id" });
    emit({ type: "assistant_message", content: "first response" });
    emit({ type: "end", reason: "idle" });
    await settle();
    expect(sendMock).toHaveBeenCalledTimes(2);

    acknowledged.resolve();
    expect(await steering).toBe(true);

    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "user", content: "same prompt", immediate: true }),
    );
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "q1",
        role: "user",
        content: "same prompt",
        immediate: true,
        status: "submitted",
      },
    ]);
    expect(
      stream.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);

    emit({ type: "user_message", content: "same prompt", clientId: "q1" });
    expect(stream.getSessionState().queuedMessages).toEqual([]);
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "user",
      content: "same prompt",
    });
  });

  test("correlates multiple pending steers by client ID", async () => {
    const sessionId = "session-multiple-steering";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const stream = SessionStream.getOrCreate(sessionId, session);

    await stream.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await stream.deliver(userMessage("first steer", "steer-1"));
    await stream.deliver(userMessage("second steer", "steer-2"));

    expect(await stream.steerQueuedMessage("steer-1")).toBe(true);
    expect(await stream.steerQueuedMessage("steer-2")).toBe(true);
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "steer-1",
        role: "user",
        content: "first steer",
        immediate: true,
        status: "submitted",
      },
      {
        clientId: "steer-2",
        role: "user",
        content: "second steer",
        immediate: true,
        status: "submitted",
      },
    ]);

    emit({ type: "user_message", content: "canonical second", clientId: "steer-2" });
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "steer-1",
        role: "user",
        content: "first steer",
        immediate: true,
        status: "submitted",
      },
    ]);

    emit({ type: "user_message", content: "canonical first", clientId: "steer-1" });
    expect(stream.getSessionState().queuedMessages).toEqual([]);
  });

  test("correlates queued system messages when their canonical input arrives", async () => {
    const sessionId = "session-system-message-correlation";
    cleanUpStreamAfterTest(sessionId);

    const { session, emit } = makeControllableSession();
    const stream = SessionStream.getOrCreate(sessionId, session);
    const systemMessage = fileEdit("plan.md", "system-1");

    await stream.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await stream.deliver(systemMessage);
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(stream.getSessionState().queuedMessages).toEqual([
      { ...systemMessage, status: "submitted" },
    ]);
    emit({ type: "system_message", content: systemMessage.content, clientId: "system-1" });

    expect(stream.getSessionState().queuedMessages).toEqual([]);
  });

  test("delivers a system message immediately into an active turn", async () => {
    const sessionId = "session-system-message-immediate";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const stream = SessionStream.getOrCreate(sessionId, session);
    const systemMessage = fileEdit("review.md", "system-immediate");

    await stream.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await stream.deliver({ ...systemMessage, immediate: true });

    expect(sendMock).toHaveBeenLastCalledWith({ ...systemMessage, immediate: true });
    expect(stream.getSessionState().queuedMessages).toEqual([
      { ...systemMessage, immediate: true, status: "submitted" },
    ]);
    expect(stream.cancelQueuedMessage("system-immediate")).toBe(false);

    emit({ type: "system_message", content: systemMessage.content, clientId: "system-immediate" });

    expect(stream.getSessionState().queuedMessages).toEqual([]);
  });

  test("steering rejects queued system messages", async () => {
    const sessionId = "session-system-message-steering";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const stream = SessionStream.getOrCreate(sessionId, makeFakeSession({ send: sendMock }));
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(fileEdit("plan.md", "system-1"));

    expect(await stream.steerQueuedMessage("system-1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "system-1",
        role: "system",
        content: {
          type: "file_edited",
          file: {
            kind: "session",
            sessionId: "notify-session",
            path: "plan.md",
          },
        },
        status: "queued",
      },
    ]);
  });

  test("keeps the message queued when steering submission fails", async () => {
    const sessionId = "session-steering-failure";
    cleanUpStreamAfterTest(sessionId);

    const sendMock = mock(async (message: SessionMessage): Promise<void> => {
      if (message.immediate) throw new Error("immediate send failed");
    });
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const stream = SessionStream.getOrCreate(sessionId, session);
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("send now", "q1"));

    await expect(stream.steerQueuedMessage("q1")).rejects.toThrow("immediate send failed");
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });

    expect(stream.getSessionState().queuedMessages).toEqual([
      { clientId: "q1", role: "user", content: "send now", status: "queued" },
    ]);
    expect(SessionStream.isRunning(sessionId)).toBe(true);
  });

  test("finishes the stream when draining fails to send", async () => {
    cleanUpStreamAfterTest("session-drain-failure");
    let sendCount = 0;
    const { session, emit } = makeControllableSession({
      // The first turn sends fine; the drained follow-up explodes.
      send: async () => {
        if (++sendCount > 1) throw new Error("send exploded");
      },
    });

    const stream = SessionStream.getOrCreate("session-drain-failure", session);
    const events = stream.subscribe();
    await stream.deliver(userMessage("first turn", "opening-id"));
    await stream.deliver(userMessage("doomed follow-up"));
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });

    emit({ type: "end", reason: "idle" });
    await settle();

    const drained = await collectStreamEvents(events);
    expect(drained.map((event) => event.type)).toEqual([
      "status",
      "message_queued",
      "user_message",
      "message_queued",
      "message_status_changed",
      "status",
      "end",
    ]);
    expect(drained.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(stream.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      error: "An error occurred. Please try again.",
    });
    expect(SessionStream.isRunning("session-drain-failure")).toBe(false);
  });
});

describe("SessionStream model selection", () => {
  test("a turn model emits model_changed into live stream state", async () => {
    cleanUpStreamAfterTest("session-model-change");

    const setModelMock = mock(async (_model: Parameters<SessionConnection["setModel"]>[0]) => {});
    const fakeSession = makeFakeSession({ setModel: setModelMock });

    const stream = SessionStream.getOrCreate("session-model-change", fakeSession);
    const events = stream.subscribe();

    await stream.deliver({
      clientId: "model-turn",
      role: "user",
      content: "Use this model",
      model: {
        provider: "copilot",
        name: "gpt-5.5",
        reasoningEffort: "high",
        contextTier: "future_tier",
      },
    });

    expect(setModelMock).toHaveBeenCalledWith({
      provider: "copilot",
      name: "gpt-5.5",
      reasoningEffort: "high",
      contextTier: "future_tier",
    });
    expect(stream.getSessionState().model).toEqual({
      provider: "copilot",
      name: "gpt-5.5",
      reasoningEffort: "high",
      contextTier: "future_tier",
    });
    expect(await nextStreamEvent(events)).toMatchObject({ type: "status", status: "thinking" });
    expect(await nextStreamEvent(events)).toEqual(
      expect.objectContaining({
        type: "model_changed",
        model: {
          provider: "copilot",
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
  test("reuses the active stream for reconnects without replaying provider history", async () => {
    cleanUpStreamAfterTest("session-reconnect");

    const { session, emit } = makeControllableSession();

    mockStreamRuntimeModules();

    const stream = SessionStream.getOrCreate("session-reconnect", session, {
      model: { provider: "copilot", name: "gpt-5" },
    });
    await stream.deliver(userMessage("Reconnect me", "client-1"));

    const iterator = (await streamSession({
      sessionId: "session-reconnect",
    }))!;
    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    let receivedCanonicalInput = false;
    const firstEvent = iterator.next().then((result) => {
      receivedCanonicalInput = true;
      return result;
    });
    await settle();
    expect(receivedCanonicalInput).toBe(false);

    emit({ type: "user_message", content: "Reconnect me", clientId: "client-1" });
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
    cleanUpStreamAfterTest("session-client-delivered-queue");

    const fakeSession = makeFakeSession();
    mockStreamRuntimeModules();

    const stream = SessionStream.getOrCreate("session-client-delivered-queue", fakeSession);
    await stream.deliver(userMessage("Already running"));

    const iterator = (await streamSession({
      sessionId: "session-client-delivered-queue",
      message: {
        clientId: "queued-client",
        content: "Queue this client prompt",
      },
    }))!;
    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    const first = await iterator.next();
    await iterator.return?.(undefined);

    expect(first).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: {
          clientId: "queued-client",
          content: "Queue this client prompt",
        },
      },
    });
    expect(stream.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({
        clientId: "queued-client",
        role: "user",
        content: "Queue this client prompt",
      }),
    ]);
  });

  test("queues a distinct message even when it carries a location", async () => {
    cleanUpStreamAfterTest("session-distinct-location-message");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules();

    const stream = SessionStream.getOrCreate("session-distinct-location-message", fakeSession);
    await stream.deliver(userMessage("Original message", "original-message"));

    const iterator = (await streamSession({
      sessionId: "session-distinct-location-message",
      message: userMessage("Distinct follow-up", "distinct-message"),
      location: {},
    }))!;
    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    expect(await iterator.next()).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: {
          clientId: "distinct-message",
          content: "Distinct follow-up",
        },
      },
    });
    await iterator.return?.(undefined);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stream.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({
        clientId: "distinct-message",
        content: "Distinct follow-up",
      }),
    ]);
  });

  test("starts a new stream turn for a client prompt", async () => {
    cleanUpStreamAfterTest("session-client-delivered-start");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({ session }),
      },
    });

    const iterator = (await streamSession({
      sessionId: "session-client-delivered-start",
      message: userMessage("Start this client prompt"),
      location: {},
    }))!;
    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    const firstEvent = iterator.next();
    emit({ type: "user_message", content: "Start this client prompt" });
    const first = await firstEvent;
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "Start this client prompt",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("starts a new stream turn for an attachment-only client message", async () => {
    cleanUpStreamAfterTest("session-client-attachment-only");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const attachment = {
      base64: "aW1hZ2U=",
      mimeType: "image/png",
    };

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({ session }),
      },
    });

    const iterator = (await streamSession({
      sessionId: "session-client-attachment-only",
      message: {
        clientId: "attachment-only",
        content: "",
        attachments: [attachment],
      },
      location: {},
    }))!;
    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    const firstEvent = iterator.next();
    emit({ type: "user_message", content: "", attachments: [attachment] });
    const first = await firstEvent;
    await iterator.return?.(undefined);

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user_message",
      content: "",
      attachments: [attachment],
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "", attachments: [attachment] }),
    );
  });

  test("retries a client follow-up if the active stream finishes before delivery", async () => {
    cleanUpStreamAfterTest("session-client-queue-retry");

    const activeSession = makeFakeSession();

    const sendMock = mock(async (_message: SessionMessage) => {
      emit({ type: "user_message", content: "Follow-up after finish" });
      emit({ type: "status", status: "thinking" });
      emit({ type: "assistant_message", content: "retried response" });
      emit({ type: "end", reason: "idle" });
    });
    const { session: resumedSession, emit } = makeControllableSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => resumedSession,
      },
    });

    const stream = SessionStream.getOrCreate("session-client-queue-retry", activeSession);
    await stream.deliver(userMessage("Already running"));

    const originalDeliver = stream.deliver.bind(stream);
    let closedBeforeDelivery = false;
    stream.deliver = (message: SessionMessage) => {
      if (!closedBeforeDelivery) {
        closedBeforeDelivery = true;
        stream.finish();
      }

      return originalDeliver(message);
    };

    const events = await collectStreamEvents(
      (await streamSession({
        sessionId: "session-client-queue-retry",
        message: userMessage("Follow-up after finish"),
      }))!,
    );

    expect(closedBeforeDelivery).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Follow-up after finish" }),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({
        type: "user_message",
        content: "Follow-up after finish",
      }),
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({
        type: "assistant_message",
        content: "retried response",
      }),
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
  });

  test("waits for a resumed client execution instead of an earlier completion", async () => {
    const sessionId = "session-client-after-announced-completion";
    cleanUpStreamAfterTest(sessionId);

    const earlier = registerPendingSessionCompletion(sessionId);
    earlier.resolve({ status: "completed", response: "Earlier result" });

    const { session, emit } = makeControllableSession();
    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => session,
      },
    });

    const events = (await streamSession({
      sessionId,
      message: userMessage("Start the client follow-up"),
    }))!;
    const completion = waitForSessions([sessionId]);

    emit({ type: "assistant_message", content: "Client follow-up result" });
    emit({ type: "end", reason: "idle" });

    await expect(completion).resolves.toEqual([
      {
        status: "completed",
        response: "Client follow-up result",
      },
    ]);
    await expect(earlier.promise).resolves.toEqual({
      status: "completed",
      response: "Earlier result",
    });
    await events.return();
  });

  test("subscribes before sending so short committed responses are delivered", async () => {
    cleanUpStreamAfterTest("session-short-response");

    const sendMock = mock(async (_message: SessionMessage) => {
      emit({ type: "user_message", content: "What is France's capital?" });
      emit({ type: "status", status: "thinking" });
      emit({ type: "assistant_message", content: "France's capital is Paris." });
      emit({ type: "end", reason: "idle" });
    });
    const { session: fakeSession, emit } = makeControllableSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
    });

    const events: SessionEvent[] = [];
    for await (const event of (await streamSession({
      sessionId: "session-short-response",
      message: userMessage("What is France's capital?"),
    }))!) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({
        type: "user_message",
        content: "What is France's capital?",
      }),
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({
        type: "assistant_message",
        content: "France's capital is Paris.",
      }),
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "What is France's capital?" }),
    );
  });

  test("emits an error end when the first send fails before the first pull", async () => {
    cleanUpStreamAfterTest("session-first-send-failure");

    const evictMock = mock((_sessionId: string, _error: unknown) => false);
    const fakeSession = makeFakeSession({
      send: async () => {
        throw new Error("send exploded");
      },
    });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
        evictCachedSessionIfStale: evictMock,
      },
    });

    const iterator = (await streamSession({
      sessionId: "session-first-send-failure",
      message: userMessage("doomed prompt"),
    }))!;

    expect(await nextStreamEvent(iterator)).toMatchObject({ type: "status", status: "thinking" });
    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "end", reason: "error" });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(SessionStream.isRunning("session-first-send-failure")).toBe(false);
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
    expect(stream.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ content: "Queue through delivery" }),
    ]);

    const completion = receipt.waitForCompletion();
    stream.finish();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("delivers a message immediately into an active stream", async () => {
    cleanUpStreamAfterTest("session-delivery-immediate");

    const sendMock = mock(async () => {});
    const { session } = makeControllableSession({ send: sendMock });
    const stream = SessionStream.getOrCreate("session-delivery-immediate", session);
    await stream.deliver(userMessage("Already running", "opening"));

    const receipt = await deliverSessionMessage("session-delivery-immediate", {
      ...userMessage("Send this now", "immediate"),
      immediate: true,
    });

    expect(receipt.disposition).toBe("queued");
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "user", content: "Send this now", immediate: true }),
    );
    expect(stream.getSessionState().queuedMessages).toEqual([
      {
        clientId: "immediate",
        role: "user",
        content: "Send this now",
        immediate: true,
        status: "submitted",
      },
    ]);
  });

  test("returns a started receipt when the message opens an idle session turn", async () => {
    cleanUpStreamAfterTest("session-delivery-sent");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
    });

    const receipt = await deliverSessionMessage(
      "session-delivery-sent",
      userMessage("Start through delivery"),
    );

    expect(receipt.disposition).toBe("started");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Start through delivery" }),
    );

    const completion = receipt.waitForCompletion();
    SessionStream.get("session-delivery-sent")!.finish();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("waits for a resumed execution instead of a retained earlier completion", async () => {
    const sessionId = "session-delivery-after-announced-completion";
    cleanUpStreamAfterTest(sessionId);

    const earlier = registerPendingSessionCompletion(sessionId);
    earlier.resolve({ status: "completed", response: "Earlier result" });

    const fakeSession = makeFakeSession();
    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
    });

    const receipt = await deliverSessionMessage(sessionId, userMessage("Start the follow-up"));

    expect(receipt.disposition).toBe("started");
    const completion = waitForSessions([sessionId]);
    SessionStream.get(sessionId)!.finish();

    await expect(completion).resolves.toEqual([{ status: "completed" }]);
    await expect(earlier.promise).resolves.toEqual({
      status: "completed",
      response: "Earlier result",
    });
  });
});

describe("createSession", () => {
  test("creates the session and starts its first message as one operation", async () => {
    cleanUpStreamAfterTest("session-headless-create");

    const calls: string[] = [];
    const sendMock = mock(async (_message: SessionMessage) => {
      calls.push("send");
    });
    const fakeSession = makeFakeSession({ send: sendMock });
    const createSessionMock = mock(
      async (_sessionId: string, _options?: realSessionRegistry.CreateSessionOptions) => {
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

    const receipt = await createSession(
      "session-headless-create",
      {
        clientId: "first-message",
        content: "Start in the background",
        model: { provider: "copilot", name: "gpt-5.5", reasoningEffort: "high" },
      },
      {
        directory: "/repo",
        useWorktree: true,
        parentSessionId: "parent-session",
        sessionType: "worker",
        name: "Background task",
      },
    );

    expect(receipt.disposition).toBe("started");
    expect(createSessionMock).toHaveBeenCalledWith("session-headless-create", {
      model: { provider: "copilot", name: "gpt-5.5", reasoningEffort: "high" },
      directory: "/repo",
      useWorktree: true,
      parentSessionId: "parent-session",
      sessionType: "worker",
      name: "Background task",
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Start in the background" }),
    );
    expect(calls).toEqual(["create", "running", "send"]);
  });

  test("seeds an artifact-backed draft into the live session", async () => {
    const sessionId = "session-artifact-draft";
    cleanUpStreamAfterTest(sessionId);
    const fakeSession = makeFakeSession();

    mockStreamRuntimeModules({
      sessionRegistry: {
        createSession: async () => ({
          session: fakeSession,
          artifactPath: "document.md",
        }),
      },
    });

    await writeSessionArtifact(sessionId, "document.md", "# Document");
    onTestFinished(() => deleteSessionFiles(sessionId));
    await createSession(sessionId, userMessage("Update the document"), {});

    expect(SessionStream.get(sessionId)?.getSessionState().artifacts).toEqual([
      { path: "document.md", updatedAt: expect.any(Number) },
    ]);
  });

  test("reads join an in-progress creation instead of reporting a missing session", async () => {
    const sessionId = "session-reads-join-creation";
    cleanUpStreamAfterTest(sessionId);
    const creating = Promise.withResolvers<{ session: SessionConnection }>();
    const loadSessionSnapshot = mock(async () => {
      throw new Error(`Session not found: ${sessionId}`);
    });

    mockStreamRuntimeModules({
      sessionRegistry: { createSession: () => creating.promise },
      snapshotCache: { loadSessionSnapshot },
    });

    const created = createSession(sessionId, userMessage("Start"), {});
    const snapshot = getSessionSnapshot(sessionId);
    const subscription = streamSession({ sessionId });
    expect(getSessionRuntimeStatus(sessionId).running).toBe(true);

    creating.resolve({ session: makeFakeSession() });
    await created;

    await expect(snapshot).resolves.toBeDefined();
    const events = await subscription;
    expect(events).toBeDefined();
    await events!.return();
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  test("reads fall back to persisted history when creation fails", async () => {
    const sessionId = "session-reads-failed-creation";
    const creating = Promise.withResolvers<never>();
    const persisted = createInitialSessionState();

    mockStreamRuntimeModules({
      sessionRegistry: { createSession: () => creating.promise },
      snapshotCache: { loadSessionSnapshot: async () => persisted },
    });

    const created = createSession(sessionId, userMessage("Start"), {});
    const snapshot = getSessionSnapshot(sessionId);

    creating.reject(new Error("Provider unavailable"));
    await expect(created).rejects.toThrow("Provider unavailable");
    expect(await snapshot).toBe(persisted);
  });
});

describe("deliverSessionMessage", () => {
  test("does not acquire a session for execution when history replay fails", async () => {
    const sessionId = "session-replay-failure";
    cleanUpStreamAfterTest(sessionId);
    const acquireSession = mock(async () => makeFakeSession());

    mockStreamRuntimeModules({
      sessionRegistry: { acquireSession },
      snapshotCache: {
        loadSessionSnapshot: async () => {
          throw new Error("History replay failed");
        },
      },
    });

    await expect(deliverSessionMessage(sessionId, userMessage("Follow up"))).rejects.toThrow(
      "History replay failed",
    );
    expect(acquireSession).not.toHaveBeenCalled();
  });

  test("starts an idle historical session immediately", async () => {
    cleanUpStreamAfterTest("session-start-helper");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
    });

    await deliverSessionMessage("session-start-helper", {
      clientId: "start-helper",
      content: "Start this session again",
      attachments: [
        {
          base64: "aW1hZ2U=",
          mimeType: "image/png",
        },
      ],
    });

    expect(SessionStream.get("session-start-helper")).toBeDefined();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Start this session again",
        attachments: [{ base64: "aW1hZ2U=", mimeType: "image/png" }],
      }),
    );
  });

  test("seeds a resumed stream from its historical snapshot", async () => {
    cleanUpStreamAfterTest("session-snapshot-seed");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
      snapshotCache: {
        loadSessionSnapshot: async () =>
          createInitialSessionState({
            messages: [
              { role: "user", content: "earlier prompt" },
              { role: "assistant", content: "earlier answer" },
            ],
          }),
      },
    });

    await deliverSessionMessage("session-snapshot-seed", userMessage("follow-up question"));

    const stream = SessionStream.get("session-snapshot-seed");
    expect(stream).toBeDefined();
    expect(
      stream!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer"]);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "follow-up question" }),
    );
  });

  test("retries once when a snapshot-seeded send hits a stale cached session", async () => {
    cleanUpStreamAfterTest("session-snapshot-stale");

    const staleSend = mock(async () => {
      throw new Error("Session not found: session-snapshot-stale");
    });
    const freshSend = mock(async (_message: SessionMessage) => {});
    const staleSession = makeFakeSession({ send: staleSend });
    const freshSession = makeFakeSession({ send: freshSend });

    // First resume returns the stale cached session; after eviction the next
    // resume is fresh.
    let resumeCount = 0;
    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => (resumeCount++ === 0 ? staleSession : freshSession),
        evictCachedSessionIfStale: (_sessionId: string, error: unknown) =>
          error instanceof Error && error.message.toLowerCase().includes("session not found"),
      },
      snapshotCache: {
        loadSessionSnapshot: async () =>
          createInitialSessionState({
            messages: [
              { role: "user", content: "earlier prompt" },
              { role: "assistant", content: "earlier answer" },
            ],
          }),
      },
    });

    await deliverSessionMessage("session-snapshot-stale", userMessage("retry me"));

    expect(staleSend).toHaveBeenCalledTimes(1);
    expect(freshSend).toHaveBeenCalledTimes(1);
    // The healed stream is live, snapshot-seeded, and carries the retried turn.
    const stream = SessionStream.get("session-snapshot-stale");
    expect(
      stream!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer"]);
  });
});

describe("single-flight stream acquisition", () => {
  test("concurrent background sends share one acquisition: creator sends, joiner queues", async () => {
    cleanUpStreamAfterTest("session-single-flight");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    // Hold both callers inside the acquisition window (the slow cold load)
    // until released, so the second call genuinely races the first.
    const resumeGate = Promise.withResolvers<void>();
    const loadSessionSnapshot = mock(async () => {
      await resumeGate.promise;
      return createInitialSessionState();
    });
    mockStreamRuntimeModules({
      sessionRegistry: { acquireSession: async () => fakeSession },
      snapshotCache: { loadSessionSnapshot },
    });

    const first = deliverSessionMessage("session-single-flight", userMessage("first prompt"));
    const second = deliverSessionMessage("session-single-flight", userMessage("second prompt"));
    resumeGate.resolve();
    await Promise.all([first, second]);

    // One cold load, one turn; the joiner's message queued behind it.
    expect(loadSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "first prompt" }),
    );
    const stream = SessionStream.get("session-single-flight");
    expect(stream!.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ role: "user", content: "second prompt" }),
    ]);
  });

  test("a client prompt during a background acquisition joins the created stream and queues", async () => {
    cleanUpStreamAfterTest("session-client-join");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    const resumeGate = Promise.withResolvers<void>();
    mockStreamRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
      snapshotCache: {
        loadSessionSnapshot: async () => {
          await resumeGate.promise;
          return createInitialSessionState();
        },
      },
    });

    // Background sender enters the acquisition window first...
    const background = deliverSessionMessage(
      "session-client-join",
      userMessage("background prompt"),
    );
    // ...then a client prompt races in; it must join, not double-send.
    const clientSubscription = streamSession({
      sessionId: "session-client-join",
      message: userMessage("client prompt"),
    });
    const clientNext = clientSubscription.then((subscription) => subscription!.next());

    resumeGate.resolve();
    await background;
    expect((await clientNext).value).toMatchObject({ type: "status", status: "thinking" });
    const clientIterator = (await clientSubscription)!;
    const clientResult = await clientIterator.next();

    // The connected joiner immediately sees its shared queue update; the
    // background input remains provider-authoritative.
    expect(clientResult).toMatchObject({
      done: false,
      value: {
        type: "message_queued",
        message: expect.objectContaining({
          role: "user",
          content: "client prompt",
        }),
      },
    });
    await clientIterator.return?.(undefined);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "background prompt" }),
    );
    const stream = SessionStream.get("session-client-join");
    expect(stream!.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ role: "user", content: "client prompt" }),
    ]);
  });
});

describe("rewindSession", () => {
  test("delegates rewind and publishes the refreshed snapshot", async () => {
    const rewind = mock(async (_timestamp: string) => {});
    const snapshot = createInitialSessionState({
      messages: [{ role: "user", content: "retained" }],
    });
    const refreshSessionSnapshot = mock(async () => snapshot);
    const broadcast = mock();
    mockStreamRuntimeModules({
      sessionRegistry: {
        withSession: async <T>(
          _sessionId: string,
          operation: (session: SessionConnection) => Promise<T>,
        ) => operation(makeFakeSession({ rewind })),
      },
      snapshotCache: { refreshSessionSnapshot },
      broadcast: { broadcast },
    });
    await expect(rewindSession("session-rewind", "2026-08-14T20:00:00.000Z")).resolves.toEqual(
      snapshot,
    );
    expect(rewind).toHaveBeenCalledWith("2026-08-14T20:00:00.000Z");
    expect(broadcast).toHaveBeenCalledWith({
      type: "session.touched",
      sessionId: "session-rewind",
    });
  });
});

describe("SessionStream.waitForCompletion", () => {
  test("reads the completed response from a snapshot when no stream is running", async () => {
    const loadSessionSnapshot = mock(async (_sessionId: string) =>
      createInitialSessionState({
        messages: [{ role: "assistant", content: "Persisted result" }],
      }),
    );
    mockStreamRuntimeModules({ snapshotCache: { loadSessionSnapshot } });
    await expect(SessionStream.waitForCompletion("session-not-running")).resolves.toEqual({
      status: "completed",
      response: "Persisted result",
    });
    expect(loadSessionSnapshot).toHaveBeenCalledWith("session-not-running");
  });

  test("resolves when the current stream finishes", async () => {
    cleanUpStreamAfterTest("session-finish-wait");

    const fakeSession = makeFakeSession();

    const stream = SessionStream.getOrCreate("session-finish-wait", fakeSession);
    const waitPromise = stream.waitForCompletion();

    stream.finish();

    await expect(waitPromise).resolves.toEqual({ status: "completed" });
  });

  test("returns timed-out status with the latest reduced assistant response", async () => {
    cleanUpStreamAfterTest("session-timeout");

    const stream = createStreamWithAssistantResponse("session-timeout", "Partial result");

    await expect(stream.waitForCompletion(1)).resolves.toEqual({
      status: "timed_out",
      response: "Partial result",
    });
    expect(SessionStream.get("session-timeout")).toBe(stream);
  });

  test.each(["", "Partial result"])(
    "returns the provider error alongside any assistant output (%j)",
    async (response) => {
      cleanUpStreamAfterTest("session-error-completion");
      const { session, emit } = makeControllableSession();
      const stream = SessionStream.getOrCreate("session-error-completion", session, {
        messages: [{ role: "assistant", content: response }],
      });
      const waitPromise = stream.waitForCompletion();

      emit({ type: "end", reason: "error", error: "Provider rate limit exceeded" });

      await expect(waitPromise).resolves.toEqual({
        status: "failed",
        ...(response ? { response } : {}),
        error: "Provider rate limit exceeded",
      });
      expect(stream.getSessionState().messages.at(-1)).toMatchObject({
        role: "assistant",
        content: response,
        error: "Provider rate limit exceeded",
      });
      await expect(stream.waitForCompletion()).resolves.toEqual(await waitPromise);
    },
  );

  test("deletion resolves waiters as completed with the latest response", async () => {
    cleanUpStreamAfterTest("session-delete-wait");

    const stream = createStreamWithAssistantResponse("session-delete-wait", "Deleted result");
    const waitPromise = stream.waitForCompletion();

    await SessionStream.remove("session-delete-wait");

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "Deleted result",
    });
  });

  test("waits for the captured stream instance, not a future replacement", async () => {
    cleanUpStreamAfterTest("session-replaced");

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

describe("waitForSessions", () => {
  test("waits for announced sessions and preserves input order", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const first = registerPendingSessionCompletion(firstId);
    const second = registerPendingSessionCompletion(secondId);
    const completion = waitForSessions([firstId, secondId]);

    second.resolve({ status: "completed", response: "Second result" });
    first.resolve({ status: "completed", response: "First result" });

    await expect(completion).resolves.toEqual([
      { status: "completed", response: "First result" },
      { status: "completed", response: "Second result" },
    ]);
  });

  test("retains an announced completion for a waiter that arrives after settlement", async () => {
    const sessionId = crypto.randomUUID();
    const receipt = registerPendingSessionCompletion(sessionId);
    const result = { status: "completed" as const, response: "Fast result" };

    receipt.resolve(result);

    await expect(waitForSessions([sessionId])).resolves.toEqual([result]);
  });

  test("times out one waiter without settling the announced session", async () => {
    const sessionId = crypto.randomUUID();
    const receipt = registerPendingSessionCompletion(sessionId);

    await expect(waitForSessions([sessionId], 1)).resolves.toEqual([{ status: "timed_out" }]);

    const completion = waitForSessions([sessionId]);
    receipt.resolve({ status: "completed", response: "Finished later" });
    await expect(completion).resolves.toEqual([
      {
        status: "completed",
        response: "Finished later",
      },
    ]);
  });

  test("rejects waiters when an announced session is canceled", async () => {
    const sessionId = crypto.randomUUID();
    registerPendingSessionCompletion(sessionId);
    const completion = waitForSessions([sessionId]);
    const error = new Error("Canceled");

    expect(rejectPendingSessionCompletion(sessionId, error)).toBe(true);
    await expect(completion).rejects.toBe(error);
    expect(rejectPendingSessionCompletion(sessionId, error)).toBe(false);
  });
});
