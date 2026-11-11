import { SessionNotFoundError, type SessionConnection } from "@providers/server/provider";
import { afterAll, describe, expect, mock, onTestFinished, test } from "bun:test";
import { deleteSessionFiles, writeSessionArtifact } from "../artifacts";
import * as realSessionRegistry from "@sessions/server/state/registry";
import * as realSnapshotCache from "@sessions/server/state/snapshots";
import * as realSessionActivity from "@sessions/server/state/activity";
import * as realBroadcast from "@workspace/server/events";
import type {
  SessionCompletion,
  SessionEvent,
  SessionMessage,
  SessionState,
  SessionSubscriptionEvent,
} from "@sessions/model";
import { createInitialSessionState } from "@sessions/model/reducer";
import { latestMessages } from "@sessions/model/transcriptPages";

const realSessionRegistryExports = { ...realSessionRegistry };
const realSnapshotCacheExports = { ...realSnapshotCache };
const realSessionActivityExports = { ...realSessionActivity };
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

function cleanUpExecutionAfterTest(sessionId: string): void {
  onTestFinished(() => {
    SessionExecution.get(sessionId)?.finish();
    realSnapshotCacheExports.evictCachedSnapshot(sessionId);
    realSessionActivity.deleteSessionActivity(sessionId);
  });
}

/** One subscriber's frames. `closed` resolves with them once the subscription closes. */
function recorder() {
  const events: SessionSubscriptionEvent[] = [];
  const closed = Promise.withResolvers<SessionSubscriptionEvent[]>();
  return {
    events,
    closed: closed.promise,
    send: (event: SessionSubscriptionEvent) => void events.push(event),
    close: () => closed.resolve(events),
  };
}

/** A subscriber already current with the execution, unless it holds another cursor. */
function recordStream(
  execution: ReturnType<typeof SessionExecution.getOrCreate>,
  after = execution.getSessionState().revision,
) {
  const stream = recorder();
  return { ...stream, unsubscribe: execution.subscribe(stream.send, stream.close, after) };
}

/** A session's subscription as the SSE route opens it, resolved once it is subscribed. */
async function sessionStream(sessionId: string, after?: number) {
  const stream = recorder();
  return {
    ...stream,
    unsubscribe: await subscribeToSession(sessionId, stream.send, stream.close, after),
  };
}

/** A provider connection with inert operations unless the test supplies behavior. */
function makeFakeSession(overrides: Partial<SessionConnection> = {}): SessionConnection {
  return {
    nativeId: "test",
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

function createExecutionWithAssistantResponse(sessionId: string, response: string) {
  return SessionExecution.getOrCreate(sessionId, makeFakeSession(), {
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

type RuntimeModuleMocks = {
  sessionRegistry?: Partial<typeof realSessionRegistry>;
  snapshotCache?: Partial<typeof realSnapshotCache>;
  broadcast?: Partial<typeof realBroadcast>;
  activity?: Partial<typeof realSessionActivity>;
};

let runtimeModuleMocks: RuntimeModuleMocks | undefined;

/** Mock the runtime modules SessionExecution imports so tests can drive executions with
 *  provider connections. Callers override the sessionRegistry, snapshotCache,
 *  and activity behavior they need; the defaults fail loudly if an unexpected path is
 *  taken, and the default snapshot cache is always empty. */
function mockRuntimeModules({
  sessionRegistry: sessionRegistryOverrides = {},
  snapshotCache: snapshotCacheOverrides = {},
  broadcast: broadcastOverrides = {},
  activity: activityOverrides = {},
}: RuntimeModuleMocks = {}) {
  onTestFinished(() => {
    runtimeModuleMocks = undefined;
  });
  runtimeModuleMocks = {
    sessionRegistry: {
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
    },
    snapshotCache: {
      getCachedSnapshot: async () => undefined,
      cacheSnapshot: () => {},
      evictCachedSnapshot: () => {},
      loadSessionSnapshot: async () => createInitialSessionState(),
      ...snapshotCacheOverrides,
    },
    activity: { setSessionActivity: () => {}, ...activityOverrides },
    broadcast: { broadcast: () => {}, ...broadcastOverrides },
  };
}

// Mock each module once, before the runtime loads it, so the runtime and this test share one
// module graph. Every export runs the current test's mock or the real implementation.
function forwardModule(id: string, key: keyof RuntimeModuleMocks, real: object) {
  mock.module(id, () =>
    Object.fromEntries(
      Object.entries(real).map(([name, implementation]) => [
        name,
        (...args: unknown[]) => {
          const mocks: Record<string, unknown> | undefined = runtimeModuleMocks?.[key];
          return ((mocks?.[name] ?? implementation) as (...args: unknown[]) => unknown)(...args);
        },
      ]),
    ),
  );
}
forwardModule("@sessions/server/state/registry", "sessionRegistry", realSessionRegistryExports);
forwardModule("@sessions/server/state/snapshots", "snapshotCache", realSnapshotCacheExports);
forwardModule("@sessions/server/state/activity", "activity", realSessionActivityExports);
forwardModule("@workspace/server/events", "broadcast", realBroadcastExports);
afterAll(() => {
  mock.module("@sessions/server/state/registry", () => realSessionRegistryExports);
  mock.module("@sessions/server/state/snapshots", () => realSnapshotCacheExports);
  mock.module("@sessions/server/state/activity", () => realSessionActivityExports);
  mock.module("@workspace/server/events", () => realBroadcastExports);
});

const {
  createSession,
  deliverSessionMessage,
  getSessionRuntimeStatus,
  expectSessionCompletion,
  getSessionSnapshot,
  subscribeToSession,
  rewindSession,
  waitForSessions,
} = await import("./index");
const { SessionExecution } = await import("./sessionExecution");

describe("SessionExecution lifecycle", () => {
  test("title events update workspace metadata without entering the session stream", async () => {
    const sessionId = "session-shared-title";
    cleanUpExecutionAfterTest(sessionId);
    const broadcast = mock();
    mockRuntimeModules({ broadcast: { broadcast } });
    const { session, emit } = makeControllableSession();
    const execution = SessionExecution.getOrCreate(sessionId, session);
    const received = recordStream(execution).closed;
    await execution.deliver(userMessage("go"));

    emit({ type: "session_title_changed", title: "Shared title" });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: "session.upserted",
      session: { id: sessionId, title: "Shared title" },
    });

    execution.finish();
    expect((await received).filter((event) => event.type === "session_title_changed")).toEqual([]);
  });

  test("provider tool calls reach subscribers as their domain effects", async () => {
    const sessionId = "session-tool-policy";
    cleanUpExecutionAfterTest(sessionId);
    mockRuntimeModules();
    const { session, emit } = makeControllableSession();
    const execution = SessionExecution.getOrCreate(sessionId, session);
    const received = recordStream(execution).closed;
    await execution.deliver(userMessage("go"));

    for (const [toolCallId, toolName, args] of [
      ["inbox", "send_to_inbox", { title: "Done" }],
      ["link", "open_session", { sessionId: "linked" }],
      ["shell", "bash", { command: "pwd" }],
    ] as const) {
      emit({ type: "tool_start", toolCallId, toolName, arguments: args });
      emit({ type: "tool_end", toolCallId, success: true });
    }
    execution.finish();

    expect(
      (await received).filter(({ type }) => type.startsWith("tool_") || type.startsWith("linked")),
    ).toMatchObject([
      { type: "linked_session_added", sessionId: "linked" },
      { type: "tool_start", toolCallId: "shell", toolName: "bash", arguments: { command: "pwd" } },
      { type: "tool_end", toolCallId: "shell", success: true },
    ]);
  });

  test("finish clears the queue, signals end-of-stream, and deregisters", async () => {
    cleanUpExecutionAfterTest("session-finish-semantics");
    const fakeSession = makeFakeSession();

    const execution = SessionExecution.getOrCreate("session-finish-semantics", fakeSession);
    const events = recordStream(execution);

    await execution.deliver(userMessage("go"));
    await execution.deliver(userMessage("queued"));
    execution.finish();

    expect((await events.closed).map((event) => event.type)).toEqual([
      "resumed",
      "status",
      "message_queued",
      "end",
    ]);
    expect(execution.getSessionState().queuedMessages).toEqual([]);
    expect(SessionExecution.isRunning("session-finish-semantics")).toBe(false);
  });

  test("a subscription after finish brings its subscriber current, then closes", async () => {
    cleanUpExecutionAfterTest("session-replay-after-finish");
    const execution = SessionExecution.getOrCreate(
      "session-replay-after-finish",
      makeFakeSession(),
    );
    const live = recordStream(execution);
    await execution.deliver(userMessage("go"));
    execution.finish();
    const [, ...run] = await live.closed;

    expect(await recordStream(execution, 0).closed).toEqual([...run, { type: "resumed" }]);
  });

  test("a covered cursor replays what it has not seen, and any other gets a snapshot", async () => {
    cleanUpExecutionAfterTest("session-reconnect-cursor");
    const { session, emit } = makeControllableSession();
    const execution = SessionExecution.getOrCreate("session-reconnect-cursor", session);
    await execution.deliver(userMessage("go"));
    emit({ type: "user_message", content: "go" });
    emit({ type: "assistant_message", content: "Done." });
    const run = recordStream(execution, 0).events.slice(0, -1) as SessionEvent[];
    const resumeFrom = (after?: number) => {
      const stream = recorder();
      execution.subscribe(stream.send, stream.close, after);
      return stream.events;
    };
    const snapshot: SessionSubscriptionEvent = {
      type: "snapshot",
      state: latestMessages(execution.getSessionState()),
    };

    expect(resumeFrom(0)).toEqual([...run, { type: "resumed" }]);
    expect(resumeFrom(run[0]!.revision)).toEqual([...run.slice(1), { type: "resumed" }]);
    // A cursor this run never issued, or none, may have missed events.
    expect(resumeFrom(1)).toEqual([snapshot]);
    expect(resumeFrom()).toEqual([snapshot]);
  });

  test("a seeded execution covers its seed's revision", async () => {
    cleanUpExecutionAfterTest("session-seeded-cursor");
    const seed = createInitialSessionState({ revision: 42 });
    const execution = SessionExecution.getOrCreate(
      "session-seeded-cursor",
      makeFakeSession(),
      seed,
    );
    await execution.deliver(userMessage("go"));

    expect(recordStream(execution, 42).events.map(({ type }) => type)).toEqual([
      "status",
      "resumed",
    ]);
    expect(recordStream(execution, 0).events.map(({ type }) => type)).toEqual(["snapshot"]);
  });

  test("caches the canonical final state before publishing terminal status", async () => {
    const sessionId = "session-finish-cache";
    cleanUpExecutionAfterTest(sessionId);

    const transitions: string[] = [];
    const cacheSnapshot = mock((_sessionId: string, snapshot: SessionState) => {
      transitions.push(`cache:${snapshot.status}`);
    });
    const setSessionActivity = mock((_sessionId: string, status: string) => {
      transitions.push(`status:${status}`);
    });
    mockRuntimeModules({
      snapshotCache: { cacheSnapshot },
      activity: { setSessionActivity },
    });

    const execution = SessionExecution.getOrCreate(sessionId, makeFakeSession());
    const subscription = recordStream(execution);
    await execution.deliver(userMessage("go"));
    transitions.length = 0;

    execution.finish();

    const events = await subscription.closed;
    expect(events.map((event) => event.type)).toEqual(["resumed", "status", "end"]);
    expect(cacheSnapshot).toHaveBeenCalledTimes(1);
    expect(cacheSnapshot).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        status: "idle",
        revision: (events.at(-1) as { revision: number }).revision,
      }),
    );
    expect(transitions).toEqual(["cache:idle", "status:unread"]);
  });

  test("does not cache aborted or failed live state", async () => {
    cleanUpExecutionAfterTest("session-abort-no-cache");
    cleanUpExecutionAfterTest("session-error-no-cache");

    const cacheSnapshot = mock((_sessionId: string, _snapshot: SessionState) => {});
    mockRuntimeModules({ snapshotCache: { cacheSnapshot } });

    const aborted = SessionExecution.getOrCreate("session-abort-no-cache", makeFakeSession());
    await aborted.deliver(userMessage("abort"));
    await aborted.abort();

    const failed = SessionExecution.getOrCreate("session-error-no-cache", makeFakeSession());
    await failed.deliver(userMessage("fail"));
    failed.finish("error");

    expect(cacheSnapshot).toHaveBeenCalledTimes(0);
  });

  test("preserves the provider error in the terminal event and transcript", async () => {
    cleanUpExecutionAfterTest("session-provider-error");

    const { session, emit } = makeControllableSession();

    const execution = SessionExecution.getOrCreate("session-provider-error", session);
    const events = recordStream(execution);
    await execution.deliver(userMessage("go"));

    const error = "You've hit your usage limit.";
    emit({ type: "end", reason: "error", error });

    const emitted = await events.closed;
    expect(emitted.map((event) => event.type)).toEqual(["resumed", "status", "end"]);
    expect(emitted.at(-1)).toMatchObject({
      type: "end",
      reason: "error",
      error,
    });
    expect(execution.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      error,
    });
    expect(SessionExecution.isRunning("session-provider-error")).toBe(false);
  });

  test("remove publishes a terminal event without global lifecycle updates", async () => {
    cleanUpExecutionAfterTest("session-remove-semantics");

    const setSessionActivity = mock((_sessionId: string, _status: string) => {});
    mockRuntimeModules({ activity: { setSessionActivity } });

    const abort = mock(async () => {});
    const fakeSession = makeFakeSession({ abort });

    const execution = SessionExecution.getOrCreate("session-remove-semantics", fakeSession);
    const events = recordStream(execution);
    await execution.deliver(userMessage("go"));
    await execution.deliver(userMessage("queued"));
    setSessionActivity.mockClear();

    await SessionExecution.remove("session-remove-semantics");

    const emittedEvents = await events.closed;
    expect(emittedEvents.map((event) => event.type)).toEqual([
      "resumed",
      "status",
      "message_queued",
      "end",
    ]);
    expect(emittedEvents.at(-1)).toMatchObject({ type: "end", reason: "idle" });
    expect(execution.getSessionState().queuedMessages).toEqual([]);
    expect(SessionExecution.isRunning("session-remove-semantics")).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
    // Deleted sessions leave the list, so no idle/unread global broadcast events are emitted.
    expect(setSessionActivity).toHaveBeenCalledTimes(0);
  });

  test("finished executions reject late delivery and queue cancellation", async () => {
    cleanUpExecutionAfterTest("session-finished-mutations");
    const fakeSession = makeFakeSession();

    const execution = SessionExecution.getOrCreate("session-finished-mutations", fakeSession);
    execution.finish();

    await expect(execution.deliver(userMessage("late follow-up", "late"))).rejects.toThrow(
      "Session execution finished before the message could be delivered.",
    );
    expect(execution.cancelQueuedMessage("late")).toBe(false);

    expect(execution.getSessionState().queuedMessages).toEqual([]);
  });
});

test("artifact refresh reconciles both clients and ignores updates after execution ends", async () => {
  const sessionId = "session-observed-artifacts";
  cleanUpExecutionAfterTest(sessionId);
  const execution = SessionExecution.getOrCreate(sessionId, makeFakeSession(), {
    artifacts: [{ path: "deleted.md", updatedAt: 1 }],
  });
  const first = recordStream(execution);
  const second = recordStream(execution);
  const created = { path: "created.html", updatedAt: 2 };

  execution.updateArtifacts([created]);
  expect(first.events).toEqual([
    { type: "resumed" },
    expect.objectContaining({ type: "artifacts_changed", artifacts: [created] }),
  ]);
  expect(second.events).toEqual(first.events);

  execution.finish();
  execution.updateArtifacts([{ path: "after-finish.md", updatedAt: 3 }]);
  expect(execution.getSessionState().artifacts).toEqual([created]);
});

describe("SessionExecution question answers", () => {
  test("answers only the pending request owned by the live canonical state", async () => {
    const sessionId = "session-question-answer";
    cleanUpExecutionAfterTest(sessionId);

    let isFirstAnswer = true;
    const answerQuestion = mock(async () => {
      const success = isFirstAnswer;
      isFirstAnswer = false;
      return success;
    });
    const { session, emit } = makeControllableSession({
      answerQuestion,
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);

    expect(
      await execution.answerQuestion({
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
    expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("waiting");

    emit({ type: "status", status: "reasoning" });
    expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("waiting");
    emit({ type: "status", status: "background" });
    expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("waiting");

    expect(
      await execution.answerQuestion({
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
      await execution.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(answerQuestion).toHaveBeenCalledTimes(2);
    expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("waiting");

    emit({ type: "question_resolved", toolCallId: "question-1", answer: "SQLite" });
    expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("running");
    expect(
      await execution.answerQuestion({
        requestId: "request-1",
        answer: "PostgreSQL",
        wasFreeform: false,
      }),
    ).toBe(false);
    expect(answerQuestion).toHaveBeenCalledTimes(2);
  });
});

describe("SessionExecution abort", () => {
  test("aborts provider work and finishes idle after its subscriber disconnects", async () => {
    const sessionId = "session-disconnected-abort";
    cleanUpExecutionAfterTest(sessionId);

    const abortProvider = mock(async () => {});
    const statuses: string[] = [];
    mockRuntimeModules({
      activity: {
        setSessionActivity: (_sessionId: string, status: string) => statuses.push(status),
      },
    });

    const execution = SessionExecution.getOrCreate(
      sessionId,
      makeFakeSession({ abort: abortProvider }),
    );
    const events = recordStream(execution);
    await execution.deliver(userMessage("go"));
    events.unsubscribe();
    await execution.abort();

    expect(abortProvider).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["running", "idle"]);
  });

  test("finishes even when the provider abort fails", async () => {
    cleanUpExecutionAfterTest("session-abort-failure");

    const calls: string[] = [];
    const fakeSession = makeFakeSession({
      abort: async () => {
        calls.push("abort");
        throw new Error("abort exploded");
      },
    });

    const execution = SessionExecution.getOrCreate("session-abort-failure", fakeSession);
    const events = recordStream(execution);
    await execution.deliver(userMessage("go"));

    await expect(execution.abort()).rejects.toThrow("abort exploded");

    expect(calls).toEqual(["abort"]);
    expect((await events.closed).map((event) => event.type)).toEqual(["resumed", "status", "end"]);
    expect(SessionExecution.isRunning("session-abort-failure")).toBe(false);
  });

  test("abort wins a race with queued-message steering", async () => {
    cleanUpExecutionAfterTest("session-abort-steering-race");
    const abortGate = Promise.withResolvers<void>();
    const sendMock = mock(async () => {});
    const execution = SessionExecution.getOrCreate(
      "session-abort-steering-race",
      makeFakeSession({
        send: sendMock,
        abort: () => abortGate.promise,
      }),
    );
    await execution.deliver(userMessage("first turn", "opening-id"));
    await execution.deliver(userMessage("queued", "q1"));

    const stopping = execution.abort();
    expect(await execution.steerQueuedMessage("q1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);

    abortGate.resolve();
    await stopping;
    expect(SessionExecution.isRunning("session-abort-steering-race")).toBe(false);
  });
});

describe("SessionExecution queued messages", () => {
  test.each(["before", "after"] as const)(
    "dispatches messages queued %s background readiness without completing the runtime",
    async (when) => {
      const sessionId = `session-background-${when}`;
      cleanUpExecutionAfterTest(sessionId);
      const send = mock(async (_message: SessionMessage) => {});
      const { session, emit } = makeControllableSession({ send });
      const execution = SessionExecution.getOrCreate(sessionId, session);
      await execution.deliver(userMessage("First", "first"));
      if (when === "before") await execution.deliver(userMessage("Next", "next"));
      emit({ type: "status", status: "background" });
      if (when === "after") await execution.deliver(userMessage("Next", "next"));
      emit({ type: "status", status: "background" });
      emit({ type: "end", reason: "idle" });
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
      expect(SessionExecution.isRunning(sessionId)).toBe(true);

      emit({ type: "status", status: "thinking" });
      expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("running");
      emit({ type: "user_message", content: "Next", clientId: "next" });
      emit({ type: "status", status: "background" });
      emit({ type: "status", status: "background" });
      expect(realSessionActivity.getSessionActivity(sessionId)?.status).toBe("background");
      expect(execution.getSessionState().queuedMessages).toEqual([]);
      expect((await execution.waitForCompletion(0)).status).toBe("timed_out");
      expect(SessionExecution.isRunning(sessionId)).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);

      emit({ type: "end", reason: "idle" });
      expect(SessionExecution.isRunning(sessionId)).toBe(false);
    },
  );

  test("an immediate message queues normally while another queued message is being sent", async () => {
    const sessionId = "session-provider-busy-submission";
    cleanUpExecutionAfterTest(sessionId);
    const submission = Promise.withResolvers<void>();
    const sent: SessionMessage[] = [];
    const { session, emit } = makeControllableSession({
      send: async (message: SessionMessage) => {
        sent.push(message);
        if (message.clientId === "second") await submission.promise;
      },
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);
    await execution.deliver(userMessage("First", "first"));
    await execution.deliver(userMessage("Second", "second"));
    emit({
      type: "user_message",
      content: "First",
      clientId: "first",
      timestamp: "2026-09-14T00:00:00Z",
    });
    emit({ type: "end", reason: "idle" });
    expect(sent.map(({ clientId }) => clientId)).toEqual(["first", "second"]);
    expect(await execution.deliver({ ...userMessage("Third", "third"), immediate: true })).toBe(
      "queued",
    );
    expect(sent).toHaveLength(2);
    expect(
      execution.getSessionState().queuedMessages.find(({ clientId }) => clientId === "third")
        ?.immediate,
    ).toBeUndefined();
    expect(execution.cancelQueuedMessage("second")).toBe(false);

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
    cleanUpExecutionAfterTest("session-drain");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const execution = SessionExecution.getOrCreate("session-drain", session);
    const received = recordStream(execution).closed;
    await execution.deliver(userMessage("first turn", "opening-id"));
    await execution.deliver(userMessage("second turn", "q1"));
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });
    emit({ type: "assistant_message", content: "first response" });

    // First idle: drains the queue into turn 2.
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "second turn" }),
    );
    expect(execution.getSessionState().queuedMessages).toEqual([
      { clientId: "q1", role: "user", content: "second turn", status: "submitted" },
    ]);
    expect(
      execution.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect(execution.cancelQueuedMessage("q1")).toBe(false);
    expect(await execution.steerQueuedMessage("q1")).toBe(false);
    expect(SessionExecution.isRunning("session-drain")).toBe(true);

    emit({ type: "user_message", content: "second turn", clientId: "q1" });
    expect(execution.getSessionState().queuedMessages).toEqual([]);
    const userMessages = execution
      .getSessionState()
      .messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages.at(-1)).toMatchObject({ content: "second turn" });

    // Second idle with an empty queue finishes the execution.
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(SessionExecution.isRunning("session-drain")).toBe(false);
    expect((await received).filter((event) => event.type === "end")).toMatchObject([
      { type: "end", reason: "idle" },
    ]);
  });

  test("cancelQueuedMessage cancels known ids and rejects unknown ones", async () => {
    cleanUpExecutionAfterTest("session-queue-remove");

    const fakeSession = makeFakeSession();

    const execution = SessionExecution.getOrCreate("session-queue-remove", fakeSession);
    await execution.deliver(userMessage("active", "active"));
    await execution.deliver(userMessage("keep me", "q1"));
    await execution.deliver(userMessage("cancel me", "q2"));

    expect(execution.cancelQueuedMessage("missing")).toBe(false);
    expect(execution.cancelQueuedMessage("q2")).toBe(true);
    expect(execution.getSessionState().queuedMessages.map((message) => message.clientId)).toEqual([
      "q1",
    ]);
  });

  test("coalesces equivalent system messages but preserves repeated user messages", async () => {
    cleanUpExecutionAfterTest("session-coalesce-direct");

    const fakeSession = makeFakeSession();
    const execution = SessionExecution.getOrCreate("session-coalesce-direct", fakeSession);
    await execution.deliver(userMessage("Already running", "active-turn"));

    await execution.deliver(fileEdit("plan.md", "edit-1"));
    await execution.deliver(fileEdit("plan.md", "edit-2"));
    await execution.deliver(fileEdit("other.md", "edit-3"));
    await execution.deliver(userMessage("hello", "u1"));
    await execution.deliver(userMessage("hello", "u2"));

    expect(execution.getSessionState().queuedMessages.map((message) => message.clientId)).toEqual([
      "edit-1",
      "edit-3",
      "u1",
      "u2",
    ]);
  });

  test("steering stays queued until the provider echoes its user message", async () => {
    const sessionId = "session-steering";
    cleanUpExecutionAfterTest(sessionId);

    const acknowledged = Promise.withResolvers<void>();
    const sendMock = mock(async (message: SessionMessage) => {
      if (message.immediate) await acknowledged.promise;
    });
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);

    await execution.deliver(userMessage("same prompt", "opening-id"));
    await execution.deliver(userMessage("same prompt", "q1"));

    const steering = execution.steerQueuedMessage("q1");
    expect(execution.getSessionState().queuedMessages).toEqual([
      {
        clientId: "q1",
        role: "user",
        content: "same prompt",
        immediate: true,
        status: "submitting",
      },
    ]);
    expect(execution.cancelQueuedMessage("q1")).toBe(false);

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
    expect(execution.getSessionState().queuedMessages).toEqual([
      {
        clientId: "q1",
        role: "user",
        content: "same prompt",
        immediate: true,
        status: "submitted",
      },
    ]);
    expect(
      execution.getSessionState().messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);

    emit({ type: "user_message", content: "same prompt", clientId: "q1" });
    expect(execution.getSessionState().queuedMessages).toEqual([]);
    expect(execution.getSessionState().messages.at(-1)).toMatchObject({
      role: "user",
      content: "same prompt",
    });
  });

  test("correlates multiple pending steers by client ID", async () => {
    const sessionId = "session-multiple-steering";
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);

    await execution.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await execution.deliver(userMessage("first steer", "steer-1"));
    await execution.deliver(userMessage("second steer", "steer-2"));

    expect(await execution.steerQueuedMessage("steer-1")).toBe(true);
    expect(await execution.steerQueuedMessage("steer-2")).toBe(true);
    expect(execution.getSessionState().queuedMessages).toEqual([
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
    expect(execution.getSessionState().queuedMessages).toEqual([
      {
        clientId: "steer-1",
        role: "user",
        content: "first steer",
        immediate: true,
        status: "submitted",
      },
    ]);

    emit({ type: "user_message", content: "canonical first", clientId: "steer-1" });
    expect(execution.getSessionState().queuedMessages).toEqual([]);
  });

  test("correlates queued system messages when their canonical input arrives", async () => {
    const sessionId = "session-system-message-correlation";
    cleanUpExecutionAfterTest(sessionId);

    const { session, emit } = makeControllableSession();
    const execution = SessionExecution.getOrCreate(sessionId, session);
    const systemMessage = fileEdit("plan.md", "system-1");

    await execution.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await execution.deliver(systemMessage);
    emit({ type: "end", reason: "idle" });
    await settle();

    expect(execution.getSessionState().queuedMessages).toEqual([
      { ...systemMessage, status: "submitted" },
    ]);
    emit({ type: "system_message", content: systemMessage.content, clientId: "system-1" });

    expect(execution.getSessionState().queuedMessages).toEqual([]);
  });

  test("delivers a system message immediately into an active turn", async () => {
    const sessionId = "session-system-message-immediate";
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);
    const systemMessage = fileEdit("review.md", "system-immediate");

    await execution.deliver(userMessage("opening", "opening-id"));
    emit({ type: "user_message", content: "opening", clientId: "opening-id" });
    await execution.deliver({ ...systemMessage, immediate: true });

    expect(sendMock).toHaveBeenLastCalledWith({ ...systemMessage, immediate: true });
    expect(execution.getSessionState().queuedMessages).toEqual([
      { ...systemMessage, immediate: true, status: "submitted" },
    ]);
    expect(execution.cancelQueuedMessage("system-immediate")).toBe(false);

    emit({ type: "system_message", content: systemMessage.content, clientId: "system-immediate" });

    expect(execution.getSessionState().queuedMessages).toEqual([]);
  });

  test("steering rejects queued system messages", async () => {
    const sessionId = "session-system-message-steering";
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async () => {});
    const execution = SessionExecution.getOrCreate(sessionId, makeFakeSession({ send: sendMock }));
    await execution.deliver(userMessage("first turn", "opening-id"));
    await execution.deliver(fileEdit("plan.md", "system-1"));

    expect(await execution.steerQueuedMessage("system-1")).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(execution.getSessionState().queuedMessages).toEqual([
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
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async (message: SessionMessage): Promise<void> => {
      if (message.immediate) throw new Error("immediate send failed");
    });
    const { session, emit } = makeControllableSession({
      send: sendMock,
    });
    const execution = SessionExecution.getOrCreate(sessionId, session);
    await execution.deliver(userMessage("first turn", "opening-id"));
    await execution.deliver(userMessage("send now", "q1"));

    await expect(execution.steerQueuedMessage("q1")).rejects.toThrow("immediate send failed");
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });

    expect(execution.getSessionState().queuedMessages).toEqual([
      { clientId: "q1", role: "user", content: "send now", status: "queued" },
    ]);
    expect(SessionExecution.isRunning(sessionId)).toBe(true);
  });

  test("finishes the execution when draining fails to send", async () => {
    cleanUpExecutionAfterTest("session-drain-failure");
    let sendCount = 0;
    const { session, emit } = makeControllableSession({
      // The first turn sends fine; the drained follow-up explodes.
      send: async () => {
        if (++sendCount > 1) throw new Error("send exploded");
      },
    });

    const execution = SessionExecution.getOrCreate("session-drain-failure", session);
    const events = recordStream(execution);
    await execution.deliver(userMessage("first turn", "opening-id"));
    await execution.deliver(userMessage("doomed follow-up"));
    emit({ type: "user_message", content: "first turn", clientId: "opening-id" });

    emit({ type: "end", reason: "idle" });
    await settle();

    const drained = await events.closed;
    expect(drained.map((event) => event.type)).toEqual([
      "resumed",
      "status",
      "message_queued",
      "user_message",
      "message_queued",
      "message_status_changed",
      "status",
      "end",
    ]);
    expect(drained.at(-1)).toMatchObject({ type: "end", reason: "error" });
    expect(execution.getSessionState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      error: "An error occurred. Please try again.",
    });
    expect(SessionExecution.isRunning("session-drain-failure")).toBe(false);
  });
});

describe("SessionExecution model selection", () => {
  test("a turn applies its model once, and the execution keeps the model the provider announces", async () => {
    cleanUpExecutionAfterTest("session-model-change");
    // Copilot keeps the previous effort when a switch omits one.
    const announced = { provider: "copilot", name: "gpt-5.5", reasoningEffort: "high" };
    const setModel = mock(async (_model: Parameters<SessionConnection["setModel"]>[0]) =>
      emit({ type: "model_changed", model: announced }),
    );
    const { session, emit } = makeControllableSession({ setModel });
    const execution = SessionExecution.getOrCreate("session-model-change", session, {
      model: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
    });
    const events = recordStream(execution);

    const requested = { provider: "copilot", name: "gpt-5.5" };
    await execution.deliver({ ...userMessage("Switch"), model: requested });
    // The next turn echoes the announced model, which is already applied.
    await execution.deliver({ ...userMessage("Continue"), model: announced });
    emit({ type: "end", reason: "idle" });
    await settle();
    execution.finish();

    expect(setModel.mock.calls).toEqual([[requested]]);
    expect(execution.getSessionState().model).toEqual(announced);
    expect((await events.closed).filter((event) => event.type === "model_changed")).toEqual([
      expect.objectContaining({ type: "model_changed", model: announced }),
    ]);
  });
});

describe("subscribeToSession", () => {
  test("reuses the active execution for reconnects without replaying provider history", async () => {
    cleanUpExecutionAfterTest("session-reconnect");

    const { session, emit } = makeControllableSession();

    const loadSessionSnapshot = mock(async () => createInitialSessionState());
    mockRuntimeModules({ snapshotCache: { loadSessionSnapshot } });

    const execution = SessionExecution.getOrCreate("session-reconnect", session, {
      model: { provider: "copilot", name: "gpt-5" },
    });
    await execution.deliver(userMessage("Reconnect me", "client-1"));

    const stream = await sessionStream("session-reconnect");
    expect(stream.events).toEqual([
      { type: "snapshot", state: expect.objectContaining({ status: "thinking" }) },
    ]);

    emit({ type: "user_message", content: "Reconnect me", clientId: "client-1" });
    stream.unsubscribe();

    expect(stream.events.at(-1)).toMatchObject({
      type: "user_message",
      content: "Reconnect me",
      clientId: "client-1",
    });
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  test("a subscription from the revision held before delivery replays the turn it started", async () => {
    const sessionId = "session-subscribe-after-delivery";
    cleanUpExecutionAfterTest(sessionId);

    const { session, emit } = makeControllableSession({
      send: async () => {
        emit({ type: "user_message", content: "What is France's capital?" });
        emit({ type: "assistant_message", content: "France's capital is Paris." });
      },
    });
    const held = createInitialSessionState({ revision: 7 });
    mockRuntimeModules({
      sessionRegistry: { acquireSession: async () => session },
      snapshotCache: { loadSessionSnapshot: async () => held },
    });

    await deliverSessionMessage(sessionId, userMessage("What is France's capital?"));
    const stream = await sessionStream(sessionId, held.revision);
    emit({ type: "end", reason: "idle" });

    expect(await stream.closed).toEqual([
      expect.objectContaining({ type: "status", status: "thinking" }),
      expect.objectContaining({ type: "user_message", content: "What is France's capital?" }),
      expect.objectContaining({
        type: "assistant_message",
        content: "France's capital is Paris.",
      }),
      { type: "resumed" },
      expect.objectContaining({ type: "end", reason: "idle" }),
    ]);
  });

  test("a turn that ends before its subscription leaves its outcome in the idle snapshot", async () => {
    const sessionId = "session-subscribe-after-finish";
    cleanUpExecutionAfterTest(sessionId);

    const snapshots = new Map<string, SessionState>();
    const { session, emit } = makeControllableSession({
      send: async () => {
        emit({ type: "user_message", content: "What is France's capital?" });
        emit({ type: "assistant_message", content: "France's capital is Paris." });
        emit({ type: "end", reason: "idle" });
      },
    });
    mockRuntimeModules({
      sessionRegistry: { acquireSession: async () => session },
      snapshotCache: {
        cacheSnapshot: (id, state) => void snapshots.set(id, state),
        loadSessionSnapshot: async (id) => snapshots.get(id) ?? createInitialSessionState(),
      },
    });

    await deliverSessionMessage(sessionId, userMessage("What is France's capital?"));

    expect(await (await sessionStream(sessionId, 0)).closed).toEqual([
      {
        type: "snapshot",
        state: expect.objectContaining({
          messages: [
            expect.objectContaining({ role: "user", content: "What is France's capital?" }),
            expect.objectContaining({ role: "assistant", content: "France's capital is Paris." }),
          ],
        }),
      },
    ]);
  });

  test("an idle session keeps a current subscriber's state and refreshes its artifacts", async () => {
    const sessionId = "session-subscribe-idle";
    const idle = createInitialSessionState({
      revision: 9,
      messages: [{ role: "assistant", content: "Done." }],
      artifacts: [{ path: "report.md", updatedAt: 2 }],
    });
    mockRuntimeModules({ snapshotCache: { loadSessionSnapshot: async () => idle } });

    expect(await (await sessionStream(sessionId, 9)).closed).toEqual([
      { type: "artifacts_changed", artifacts: idle.artifacts },
      { type: "resumed" },
    ]);
    expect(await (await sessionStream(sessionId, 8)).closed).toEqual([
      { type: "snapshot", state: latestMessages(idle) },
    ]);
  });

  test("a missing session says so, and any other failure fails the subscription", async () => {
    const sessionId = "session-subscribe-missing";
    const loadSessionSnapshot = mock(async (): Promise<SessionState> => {
      throw new SessionNotFoundError(sessionId);
    });
    mockRuntimeModules({ snapshotCache: { loadSessionSnapshot } });

    expect(await (await sessionStream(sessionId)).closed).toEqual([{ type: "deleted", sessionId }]);

    loadSessionSnapshot.mockRejectedValue(new Error("History unavailable"));
    await expect(sessionStream(sessionId)).rejects.toThrow("History unavailable");
  });
});

describe("delivery receipts", () => {
  test("returns a queued receipt when the target execution is already live", async () => {
    cleanUpExecutionAfterTest("session-delivery-queued");

    const fakeSession = makeFakeSession();

    const execution = SessionExecution.getOrCreate("session-delivery-queued", fakeSession);
    await execution.deliver(userMessage("Already running"));

    const receipt = await deliverSessionMessage(
      "session-delivery-queued",
      userMessage("Queue through delivery"),
    );

    expect(receipt.disposition).toBe("queued");
    expect(execution.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ content: "Queue through delivery" }),
    ]);

    const completion = receipt.waitForCompletion();
    execution.finish();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("delivers a message immediately into an active execution", async () => {
    cleanUpExecutionAfterTest("session-delivery-immediate");

    const sendMock = mock(async () => {});
    const { session } = makeControllableSession({ send: sendMock });
    const execution = SessionExecution.getOrCreate("session-delivery-immediate", session);
    await execution.deliver(userMessage("Already running", "opening"));

    const receipt = await deliverSessionMessage("session-delivery-immediate", {
      ...userMessage("Send this now", "immediate"),
      immediate: true,
    });

    expect(receipt.disposition).toBe("queued");
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "user", content: "Send this now", immediate: true }),
    );
    expect(execution.getSessionState().queuedMessages).toEqual([
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
    cleanUpExecutionAfterTest("session-delivery-sent");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockRuntimeModules({
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
    SessionExecution.get("session-delivery-sent")!.finish();
    await expect(completion).resolves.toEqual({ status: "completed" });
  });

  test("waits for a resumed execution instead of a retained earlier completion", async () => {
    const sessionId = "session-delivery-after-expected-completion";
    cleanUpExecutionAfterTest(sessionId);

    expectSessionCompletion(
      sessionId,
      Promise.resolve({ status: "completed", response: "Earlier result" }),
    );

    const fakeSession = makeFakeSession();
    mockRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => fakeSession,
      },
    });

    const receipt = await deliverSessionMessage(sessionId, userMessage("Start the follow-up"));

    expect(receipt.disposition).toBe("started");
    const completion = waitForSessions([sessionId]);
    SessionExecution.get(sessionId)!.finish();

    await expect(completion).resolves.toEqual([{ status: "completed" }]);
  });
});

describe("delivery retries", () => {
  test("rejects a delivery whose first send fails and leaves no live execution", async () => {
    const sessionId = "session-first-send-failure";
    cleanUpExecutionAfterTest(sessionId);

    mockRuntimeModules({
      sessionRegistry: {
        acquireSession: async () =>
          makeFakeSession({
            send: async () => {
              throw new Error("send exploded");
            },
          }),
        evictCachedSessionIfStale: () => false,
      },
    });

    await expect(deliverSessionMessage(sessionId, userMessage("doomed prompt"))).rejects.toThrow(
      "send exploded",
    );
    expect(SessionExecution.isRunning(sessionId)).toBe(false);
  });

  test("retries a delivery once if the live execution finishes before it arrives", async () => {
    const sessionId = "session-delivery-retry";
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async (_message: SessionMessage) => {});
    mockRuntimeModules({
      sessionRegistry: { acquireSession: async () => makeFakeSession({ send: sendMock }) },
    });

    const execution = SessionExecution.getOrCreate(sessionId, makeFakeSession());
    await execution.deliver(userMessage("Already running"));
    const originalDeliver = execution.deliver.bind(execution);
    execution.deliver = (message: SessionMessage) => {
      execution.finish();
      return originalDeliver(message);
    };

    const receipt = await deliverSessionMessage(sessionId, userMessage("Follow-up after finish"));

    expect(receipt.disposition).toBe("started");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Follow-up after finish" }),
    );
  });
});

describe("createSession", () => {
  test("creates the session and starts its first message as one operation", async () => {
    cleanUpExecutionAfterTest("session-headless-create");

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
    const setSessionActivity = mock((_sessionId: string, status: string) => {
      calls.push(status);
    });

    mockRuntimeModules({
      sessionRegistry: { createSession: createSessionMock },
      activity: { setSessionActivity },
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
        name: "Background task",
      },
    );

    expect(receipt.disposition).toBe("started");
    expect(createSessionMock).toHaveBeenCalledWith("session-headless-create", {
      model: { provider: "copilot", name: "gpt-5.5", reasoningEffort: "high" },
      directory: "/repo",
      useWorktree: true,
      parentSessionId: "parent-session",
      name: "Background task",
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Start in the background" }),
    );
    expect(calls).toEqual(["create", "running", "send"]);
  });

  test("queues a located message onto a session that is already live", async () => {
    const sessionId = "session-located-queue";
    cleanUpExecutionAfterTest(sessionId);

    const sendMock = mock(async (_message: SessionMessage) => {});
    mockRuntimeModules();

    const execution = SessionExecution.getOrCreate(sessionId, makeFakeSession({ send: sendMock }));
    await execution.deliver(userMessage("Original message"));

    const receipt = await createSession(sessionId, userMessage("Second tab's first send"), {});

    expect(receipt.disposition).toBe("queued");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(execution.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ content: "Second tab's first send" }),
    ]);
  });

  test("seeds an artifact-backed draft into the live session", async () => {
    const sessionId = "session-artifact-draft";
    cleanUpExecutionAfterTest(sessionId);
    const fakeSession = makeFakeSession();

    mockRuntimeModules({
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

    expect(SessionExecution.get(sessionId)?.getSessionState().artifacts).toEqual([
      { path: "document.md", updatedAt: expect.any(Number) },
    ]);
  });

  test("reads join an in-progress creation instead of reporting a missing session", async () => {
    const sessionId = "session-reads-join-creation";
    cleanUpExecutionAfterTest(sessionId);
    const creating = Promise.withResolvers<{ session: SessionConnection }>();
    const loadSessionSnapshot = mock(async () => {
      throw new Error(`Session not found: ${sessionId}`);
    });

    mockRuntimeModules({
      sessionRegistry: { createSession: () => creating.promise },
      snapshotCache: { loadSessionSnapshot },
    });

    const created = createSession(sessionId, userMessage("Start"), {});
    const snapshot = getSessionSnapshot(sessionId);
    const subscribing = sessionStream(sessionId);
    expect(getSessionRuntimeStatus(sessionId).running).toBe(true);

    creating.resolve({ session: makeFakeSession() });
    await created;

    await expect(snapshot).resolves.toBeDefined();
    const stream = await subscribing;
    stream.unsubscribe();
    expect(stream.events).toEqual([
      { type: "snapshot", state: expect.objectContaining({ status: "thinking" }) },
    ]);
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  test("reads fall back to persisted history when creation fails", async () => {
    const sessionId = "session-reads-failed-creation";
    const creating = Promise.withResolvers<never>();
    const persisted = createInitialSessionState();

    mockRuntimeModules({
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
    cleanUpExecutionAfterTest(sessionId);
    const acquireSession = mock(async () => makeFakeSession());

    mockRuntimeModules({
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
    cleanUpExecutionAfterTest("session-start-helper");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockRuntimeModules({
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

    expect(SessionExecution.get("session-start-helper")).toBeDefined();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Start this session again",
        attachments: [{ base64: "aW1hZ2U=", mimeType: "image/png" }],
      }),
    );
  });

  test("seeds a resumed execution from its historical snapshot", async () => {
    cleanUpExecutionAfterTest("session-snapshot-seed");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    mockRuntimeModules({
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

    const execution = SessionExecution.get("session-snapshot-seed");
    expect(execution).toBeDefined();
    expect(
      execution!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer"]);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "follow-up question" }),
    );
  });

  test("retries once when a snapshot-seeded send hits a stale cached session", async () => {
    cleanUpExecutionAfterTest("session-snapshot-stale");

    const staleSend = mock(async () => {
      throw new SessionNotFoundError("session-snapshot-stale");
    });
    const freshSend = mock(async (_message: SessionMessage) => {});
    const staleSession = makeFakeSession({ send: staleSend });
    const freshSession = makeFakeSession({ send: freshSend });

    // First resume returns the stale cached session; after eviction the next
    // resume is fresh.
    let resumeCount = 0;
    mockRuntimeModules({
      sessionRegistry: {
        acquireSession: async () => (resumeCount++ === 0 ? staleSession : freshSession),
        evictCachedSessionIfStale: (_sessionId: string, error: unknown) =>
          error instanceof SessionNotFoundError,
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
    // The healed execution is live, snapshot-seeded, and carries the retried turn.
    const execution = SessionExecution.get("session-snapshot-stale");
    expect(
      execution!
        .getSessionState()
        .messages.map((message) => ("content" in message ? message.content : "")),
    ).toEqual(["earlier prompt", "earlier answer"]);
  });
});

describe("single-flight execution acquisition", () => {
  test("concurrent background sends share one acquisition: creator sends, joiner queues", async () => {
    cleanUpExecutionAfterTest("session-single-flight");

    const sendMock = mock(async (_message: SessionMessage) => {});
    const fakeSession = makeFakeSession({ send: sendMock });

    // Hold both callers inside the acquisition window (the slow cold load)
    // until released, so the second call genuinely races the first.
    const resumeGate = Promise.withResolvers<void>();
    const loadSessionSnapshot = mock(async () => {
      await resumeGate.promise;
      return createInitialSessionState();
    });
    mockRuntimeModules({
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
    const execution = SessionExecution.get("session-single-flight");
    expect(execution!.getSessionState().queuedMessages).toEqual([
      expect.objectContaining({ role: "user", content: "second prompt" }),
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
    mockRuntimeModules({
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

describe("SessionExecution.waitForCompletion", () => {
  test("reads the completed response from a snapshot when no execution is running", async () => {
    const loadSessionSnapshot = mock(async (_sessionId: string) =>
      createInitialSessionState({
        messages: [{ role: "assistant", content: "Persisted result" }],
      }),
    );
    mockRuntimeModules({ snapshotCache: { loadSessionSnapshot } });
    await expect(SessionExecution.waitForCompletion("session-not-running")).resolves.toEqual({
      status: "completed",
      response: "Persisted result",
    });
    expect(loadSessionSnapshot).toHaveBeenCalledWith("session-not-running");
  });

  test("resolves when the current execution finishes", async () => {
    cleanUpExecutionAfterTest("session-finish-wait");

    const fakeSession = makeFakeSession();

    const execution = SessionExecution.getOrCreate("session-finish-wait", fakeSession);
    const waitPromise = execution.waitForCompletion();

    execution.finish();

    await expect(waitPromise).resolves.toEqual({ status: "completed" });
  });

  test("returns timed-out status with the latest reduced assistant response", async () => {
    cleanUpExecutionAfterTest("session-timeout");

    const execution = createExecutionWithAssistantResponse("session-timeout", "Partial result");

    await expect(execution.waitForCompletion(1)).resolves.toEqual({
      status: "timed_out",
      response: "Partial result",
    });
    expect(SessionExecution.get("session-timeout")).toBe(execution);
  });

  test.each(["", "Partial result"])(
    "returns the provider error alongside any assistant output (%j)",
    async (response) => {
      cleanUpExecutionAfterTest("session-error-completion");
      const { session, emit } = makeControllableSession();
      const execution = SessionExecution.getOrCreate("session-error-completion", session, {
        messages: [{ role: "assistant", content: response }],
      });
      const waitPromise = execution.waitForCompletion();

      emit({ type: "end", reason: "error", error: "Provider rate limit exceeded" });

      await expect(waitPromise).resolves.toEqual({
        status: "failed",
        ...(response ? { response } : {}),
        error: "Provider rate limit exceeded",
      });
      expect(execution.getSessionState().messages.at(-1)).toMatchObject({
        role: "assistant",
        content: response,
        error: "Provider rate limit exceeded",
      });
      await expect(execution.waitForCompletion()).resolves.toEqual(await waitPromise);
    },
  );

  test("deletion resolves waiters as completed with the latest response", async () => {
    cleanUpExecutionAfterTest("session-delete-wait");

    const execution = createExecutionWithAssistantResponse("session-delete-wait", "Deleted result");
    const waitPromise = execution.waitForCompletion();

    await SessionExecution.remove("session-delete-wait");

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "Deleted result",
    });
  });

  test("waits for the captured execution instance, not a future replacement", async () => {
    cleanUpExecutionAfterTest("session-replaced");

    const first = createExecutionWithAssistantResponse("session-replaced", "First result");
    const waitPromise = first.waitForCompletion();

    first.finish();
    const second = SessionExecution.getOrCreate("session-replaced", makeFakeSession());

    await expect(waitPromise).resolves.toEqual({
      status: "completed",
      response: "First result",
    });
    expect(SessionExecution.get("session-replaced")).toBe(second);
  });
});

describe("waitForSessions", () => {
  function expectCompletion(sessionId: string) {
    const completion = Promise.withResolvers<SessionCompletion>();
    expectSessionCompletion(sessionId, completion.promise);
    return completion;
  }

  test("waits for expected sessions and preserves input order", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const first = expectCompletion(firstId);
    const second = expectCompletion(secondId);
    const completion = waitForSessions([firstId, secondId]);

    second.resolve({ status: "completed", response: "Second result" });
    first.resolve({ status: "completed", response: "First result" });

    await expect(completion).resolves.toEqual([
      { status: "completed", response: "First result" },
      { status: "completed", response: "Second result" },
    ]);
  });

  test("retains an expected completion for a waiter that arrives after settlement", async () => {
    const sessionId = crypto.randomUUID();
    const result = { status: "completed" as const, response: "Fast result" };
    expectCompletion(sessionId).resolve(result);

    await expect(waitForSessions([sessionId])).resolves.toEqual([result]);
  });

  test("times out one waiter without settling the expected session", async () => {
    const sessionId = crypto.randomUUID();
    const expected = expectCompletion(sessionId);

    await expect(waitForSessions([sessionId], 1)).resolves.toEqual([{ status: "timed_out" }]);

    const completion = waitForSessions([sessionId]);
    expected.resolve({ status: "completed", response: "Finished later" });
    await expect(completion).resolves.toEqual([
      {
        status: "completed",
        response: "Finished later",
      },
    ]);
  });

  test("rejects waiters when an expected completion fails", async () => {
    const sessionId = crypto.randomUUID();
    const expected = expectCompletion(sessionId);
    const completion = waitForSessions([sessionId]);
    const error = new Error("Canceled");

    expected.reject(error);
    await expect(completion).rejects.toBe(error);
  });
});
