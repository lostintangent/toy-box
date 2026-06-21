import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { SessionStream } from "./stream";

describe("SessionStream lifecycle", () => {
  test("close clears the queue, signals end-of-stream, and deregisters", () => {
    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-close-semantics", fakeSession);
    stream.startTurn("go");
    stream.addQueuedMessage({ role: "user", content: "queued" });

    const received: Array<unknown> = [];
    stream.subscribe((event) => received.push(event));

    stream.close();

    expect(received).toEqual([null]);
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(stream.getBufferSince()).toEqual([]);
    expect(SessionStream.isRunning("session-close-semantics")).toBe(false);
  });

  test("detach deregisters without signalling end-of-stream", () => {
    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-detach-semantics", fakeSession);
    stream.startTurn("go");

    const received: Array<unknown> = [];
    stream.subscribe((event) => received.push(event));

    stream.detach();

    expect(received).toEqual([]);
    expect(SessionStream.isRunning("session-detach-semantics")).toBe(false);
    // Buffer survives detach — the runtime object is cleaned up, not the turn.
    expect(stream.getBufferSince().length).toBeGreaterThan(0);
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
    stream.startTurn("first turn");
    stream.addQueuedMessage({ id: "q1", role: "user", content: "second turn" });

    const received: Array<{ type: string } | null> = [];
    stream.subscribe((event) => received.push(event));

    // First idle: drains the queue into turn 2.
    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMock).toHaveBeenCalledWith({ prompt: "second turn", attachments: undefined });
    expect(stream.getQueuedMessages()).toEqual([]);
    expect(received.map((e) => e?.type)).toContain("message_dequeued");
    expect(SessionStream.isRunning("session-drain")).toBe(true);

    // Second idle with an empty queue: closes the stream.
    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received.at(-1)).toBe(null);
    expect(SessionStream.isRunning("session-drain")).toBe(false);
  });

  test("closes the stream when draining fails to send", async () => {
    let sdkHandler: ((event: { type: string; data: unknown }) => void) | undefined;
    const fakeSession = {
      on: (handler: (event: { type: string; data: unknown }) => void) => {
        sdkHandler = handler;
        return () => {};
      },
      send: async () => {
        throw new Error("send exploded");
      },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-drain-failure", fakeSession);
    stream.startTurn("first turn");
    stream.addQueuedMessage({ role: "user", content: "doomed follow-up" });

    sdkHandler!({ type: "session.idle", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(SessionStream.isRunning("session-drain-failure")).toBe(false);
  });

  test("removeQueuedMessage cancels known ids and rejects unknown ones", () => {
    onTestFinished(() => {
      SessionStream.close("session-queue-remove");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-queue-remove", fakeSession);
    stream.addQueuedMessage({ id: "q1", role: "user", content: "keep me" });
    stream.addQueuedMessage({ id: "q2", role: "user", content: "cancel me" });

    expect(stream.removeQueuedMessage("missing")).toBe(false);
    expect(stream.removeQueuedMessage("q2")).toBe(true);
    expect(stream.getQueuedMessages().map((m) => m.id)).toEqual(["q1"]);
  });
});

describe("SessionStream buffer", () => {
  test("getBufferSince filters by cursor and returns a defensive copy", () => {
    onTestFinished(() => {
      SessionStream.close("session-buffer-since");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-buffer-since", fakeSession);
    stream.startTurn("go");
    stream.addQueuedMessage({ id: "q1", role: "user", content: "one" });
    stream.addQueuedMessage({ id: "q2", role: "user", content: "two" });

    const all = stream.getBufferSince();
    expect(all.map((e) => e.type)).toEqual(["user_message", "message_queued", "message_queued"]);

    const afterFirst = stream.getBufferSince(all[0].eventId);
    expect(afterFirst.map((e) => e.type)).toEqual(["message_queued", "message_queued"]);

    // Mutating the returned array must not affect the internal buffer.
    all.length = 0;
    expect(stream.getBufferSince().length).toBe(3);
  });

  test("caps the buffer at the retention limit, keeping the newest events", () => {
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

    const buffer = stream.getBufferSince();
    expect(buffer.length).toBe(1500);
    expect(buffer.at(-1)).toMatchObject({ type: "delta", content: "chunk-1599 " });
    expect(buffer[0]).toMatchObject({ type: "delta", content: "chunk-100 " });
  });
});

describe("SessionStream event IDs", () => {
  test("increase across consecutive stream instances for the same session", () => {
    onTestFinished(() => {
      SessionStream.close("session-event-id-reuse");
    });

    const makeFakeSession = () =>
      ({
        on: () => () => {},
      }) as unknown as CopilotSession;

    const first = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    first.startTurn("First run");
    const firstEventId = first.getBufferSince()[0]?.eventId;
    first.detach();

    const second = SessionStream.getOrCreate("session-event-id-reuse", makeFakeSession());
    second.startTurn("Second run");
    const secondEventId = second.getBufferSince()[0]?.eventId;

    expect(firstEventId).toEqual(expect.any(Number));
    expect(secondEventId).toEqual(expect.any(Number));
    expect(secondEventId!).toBeGreaterThan(firstEventId!);
  });
});

describe("SessionStream model configuration", () => {
  test("setModel emits a model_changed event into live stream state", async () => {
    onTestFinished(() => {
      SessionStream.close("session-model-change");
    });

    const setModelMock = mock(
      async (_model: string, _options?: { reasoningEffort?: string }) => {},
    );
    const fakeSession = {
      on: () => () => {},
      setModel: setModelMock,
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-model-change", fakeSession);
    const seenEvents: unknown[] = [];
    const unsubscribe = stream.subscribe((event) => {
      if (event) seenEvents.push(event);
    });

    await stream.setModel({ model: "gpt-5.5", reasoningEffort: "high" });
    unsubscribe();

    expect(setModelMock).toHaveBeenCalledWith("gpt-5.5", { reasoningEffort: "high" });
    expect(stream.getSessionState().modelConfiguration).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(seenEvents).toEqual([
      expect.objectContaining({
        type: "model_changed",
        modelConfiguration: { model: "gpt-5.5", reasoningEffort: "high" },
      }),
    ]);
  });
});

describe("createClientSessionStream", () => {
  test("reuses the active stream for reconnects without replaying SDK history", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-reconnect");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    mock.module("../state/sessionCache", () => ({
      createSession: async () => {
        throw new Error("createSession should not be used for reconnect");
      },
      getOrResumeSession: async () => {
        throw new Error("getOrResumeSession should not be used for reconnect");
      },
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => {},
      markSessionUnread: () => {},
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => {},
      emitSessionIdle: () => {},
      emitSessionTouched: () => {},
      updateSessionSummary: () => {},
    }));

    const {
      SessionStream: ImportedSessionStream,
      createClientSessionStream: importedCreateStream,
    } = await import("./stream");

    const stream = ImportedSessionStream.getOrCreate("session-reconnect", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    stream.startTurn("Reconnect me");

    const iterator = importedCreateStream({ sessionId: "session-reconnect" });
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

    mock.module("../state/sessionCache", () => ({
      createSession: async () => {
        throw new Error("createSession should not be used for a stale draft retry");
      },
      getOrResumeSession: async () => {
        throw new Error("getOrResumeSession should not be used for a stale draft retry");
      },
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => {},
      markSessionUnread: () => {},
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => {},
      emitSessionIdle: () => {},
      emitSessionTouched: () => {},
      updateSessionSummary: () => {},
    }));

    const {
      SessionStream: ImportedSessionStream,
      createClientSessionStream: importedCreateStream,
    } = await import("./stream");

    const stream = ImportedSessionStream.getOrCreate("session-draft-race", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    stream.startTurn("Original draft prompt", "client-1");

    const iterator = importedCreateStream({
      sessionId: "session-draft-race",
      prompt: "Original draft prompt",
      startNew: true,
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
    expect(sendMock).toHaveBeenCalledTimes(0);
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

    mock.module("../state/sessionCache", () => ({
      createSession: async () => {
        throw new Error("createSession should not be used for an idle historical session");
      },
      getOrResumeSession: async () => ({
        session: fakeSession,
        events: [],
      }),
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => {},
      markSessionUnread: () => {},
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => {},
      emitSessionIdle: () => {},
      emitSessionTouched: () => {},
      updateSessionSummary: () => {},
    }));

    const { createClientSessionStream: importedCreateStream } = await import("./stream");

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of importedCreateStream({
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
    ]);
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "What is France's capital?",
      attachments: undefined,
    });
  });
});

describe("sendOrQueueSessionMessage", () => {
  test("queues prompts onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-queue-helper");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-queue-helper", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
    stream.startTurn("Already running");

    const { sendOrQueueSessionMessage: importedSendOrQueue } = await import("./stream");

    await importedSendOrQueue({
      sessionId: "session-queue-helper",
      prompt: "Queue this follow-up",
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

    mock.module("../state/sessionCache", () => ({
      createSession: async () => {
        throw new Error("createSession should not be used for an idle historical session");
      },
      getOrResumeSession: async () => ({
        session: fakeSession,
        events: [],
      }),
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => {},
      markSessionUnread: () => {},
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => {},
      emitSessionIdle: () => {},
      emitSessionTouched: () => {},
      updateSessionSummary: () => {},
    }));

    const { sendOrQueueSessionMessage: importedSendOrQueue, SessionStream: ImportedSessionStream } =
      await import("./stream");

    await importedSendOrQueue({
      sessionId: "session-start-helper",
      prompt: "Start this session again",
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
});

describe("SessionStream.waitForClose", () => {
  test("falls back to persisted history when no stream is running for the session", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    mock.module("../state/sessionCache", () => ({
      createSession: async () => {
        throw new Error("createSession should not be used");
      },
      getOrResumeSession: async () => ({
        session: {} as CopilotSession,
        events: [
          {
            type: "assistant.message",
            data: { content: "Persisted result" },
          },
        ],
      }),
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => {},
      markSessionUnread: () => {},
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => {},
      emitSessionIdle: () => {},
      emitSessionTouched: () => {},
      updateSessionSummary: () => {},
    }));
    const { SessionStream: ImportedSessionStream } = await import("./stream");
    await expect(ImportedSessionStream.waitForClose("session-not-running")).resolves.toBe(
      "Persisted result",
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
    const waitPromise = stream.waitForClose();

    stream.close();

    await expect(waitPromise).resolves.toBe("");
  });

  test("returns the latest reduced assistant response when a timeout expires", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-timeout");
    });

    const fakeSession = {
      on: () => () => {},
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-timeout", fakeSession);
    stream.getSessionState().messages.push({ role: "assistant", content: "Partial result" });

    await expect(stream.waitForClose(1)).resolves.toBe("Partial result");
    expect(SessionStream.get("session-timeout")).toBe(stream);
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
    const waitPromise = first.waitForClose();

    first.detach();
    const second = SessionStream.getOrCreate("session-replaced", makeFakeSession());

    await expect(waitPromise).resolves.toBe("First result");
    expect(SessionStream.get("session-replaced")).toBe(second);
  });
});
