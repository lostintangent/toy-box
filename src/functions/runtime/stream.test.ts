import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createInitialSession } from "@/lib/session/sessionReducer";
import { prepareSessionForNextTurn, SessionStream } from "./stream";

describe("prepareSessionForNextTurn", () => {
  test("preserves durable session state while clearing turn-scoped state", () => {
    const previousState = createInitialSession({
      messages: [
        { role: "user", content: "Open the ocean session" },
        { role: "assistant", content: "Done." },
      ],
      queuedMessages: [
        {
          id: "queued-1",
          role: "user",
          content: "Now summarize it",
        },
      ],
      todos: [{ id: "todo-1", title: "Inspect stream state", status: "in_progress" }],
      linkedSessionIds: ["session-1", "session-2"],
      status: "responding",
      reasoningContent: "thinking...",
      model: "claude-sonnet-4.6",
    });
    previousState.pendingToolCalls.set("tool-1", {
      toolCallId: "tool-1",
      toolName: "open_session",
      arguments: { sessionId: "session-1" },
    });

    const nextState = prepareSessionForNextTurn(previousState);

    expect(nextState).toBe(previousState);
    expect(nextState.messages).toEqual([
      { role: "user", content: "Open the ocean session" },
      { role: "assistant", content: "Done." },
    ]);
    expect(nextState.todos).toEqual([
      { id: "todo-1", title: "Inspect stream state", status: "in_progress" },
    ]);
    expect(nextState.linkedSessionIds).toEqual(["session-1", "session-2"]);
    expect(nextState.model).toBe("claude-sonnet-4.6");
    expect(nextState.queuedMessages).toEqual([
      {
        id: "queued-1",
        role: "user",
        content: "Now summarize it",
      },
    ]);

    expect(nextState.reasoningContent).toBe("");
    expect(nextState.status).toBe("thinking");
    expect(nextState.pendingToolCalls.size).toBe(0);
    expect(nextState.pendingOptimisticUserMessage).toBeUndefined();
  });
});

describe("createSessionEventStream", () => {
  test("reuses the active stream for reconnects without replaying SDK history", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-reconnect");
    });

    const fakeSession = {
      on: () => () => { },
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
      markSessionRead: () => { },
      markSessionUnread: () => { },
    }));
    mock.module("../state/attachments", () => ({
      writeAttachments: async () => undefined,
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => { },
      emitSessionIdle: () => { },
      emitSessionTouched: () => { },
      updateSessionSummary: () => { },
    }));

    const { SessionStream: ImportedSessionStream, createSessionEventStream: importedCreateStream } =
      await import("./stream");

    const stream = ImportedSessionStream.getOrCreate("session-reconnect", fakeSession, {
      model: "gpt-5",
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

    const sendMock = mock(async (_message: { prompt: string }) => { });
    const fakeSession = {
      send: sendMock,
      on: () => () => { },
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
      markSessionRead: () => { },
      markSessionUnread: () => { },
    }));
    mock.module("../state/attachments", () => ({
      writeAttachments: async () => undefined,
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => { },
      emitSessionIdle: () => { },
      emitSessionTouched: () => { },
      updateSessionSummary: () => { },
    }));

    const { SessionStream: ImportedSessionStream, createSessionEventStream: importedCreateStream } =
      await import("./stream");

    const stream = ImportedSessionStream.getOrCreate("session-draft-race", fakeSession, {
      model: "gpt-5",
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
});

describe("sendOrQueueSessionMessage", () => {
  test("queues prompts onto an active stream", async () => {
    onTestFinished(() => {
      mock.restore();
      SessionStream.close("session-queue-helper");
    });

    const fakeSession = {
      on: () => () => { },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate("session-queue-helper", fakeSession, {
      model: "gpt-5",
    });
    stream.startTurn("Already running");

    const { sendOrQueueSessionMessage: importedSendOrQueue } = await import("./stream");

    const result = await importedSendOrQueue({
      sessionId: "session-queue-helper",
      prompt: "Queue this follow-up",
    });

    expect(result).toMatchObject({
      stream,
      disposition: "queued",
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

    const sendMock = mock(async (_message: { prompt: string }) => { });
    const fakeSession = {
      send: sendMock,
      on: () => () => { },
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
      markSessionRead: () => { },
      markSessionUnread: () => { },
    }));
    mock.module("../state/attachments", () => ({
      writeAttachments: async () => undefined,
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => { },
      emitSessionIdle: () => { },
      emitSessionTouched: () => { },
      updateSessionSummary: () => { },
    }));

    const { sendOrQueueSessionMessage: importedSendOrQueue, SessionStream: ImportedSessionStream } =
      await import("./stream");

    const result = await importedSendOrQueue({
      sessionId: "session-start-helper",
      prompt: "Start this session again",
    });

    expect(result.disposition).toBe("started");
    expect(sendMock).toHaveBeenCalledWith({
      prompt: "Start this session again",
      attachments: undefined,
    });
    expect(ImportedSessionStream.get("session-start-helper")).toBeDefined();
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
        events: [],
      }),
    }));
    mock.module("../state/unread", () => ({
      markSessionRead: () => { },
      markSessionUnread: () => { },
    }));
    mock.module("../state/attachments", () => ({
      writeAttachments: async () => undefined,
    }));
    mock.module("./broadcast", () => ({
      emitSessionRunning: () => { },
      emitSessionIdle: () => { },
      emitSessionTouched: () => { },
      updateSessionSummary: () => { },
    }));
    mock.module("@/functions/sdk/sessionState", () => ({
      initializeSessionStateFromSdkHistory: async () => ({
        messages: [{ role: "assistant", content: "Persisted result" }],
      }),
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
      on: () => () => { },
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
      on: () => () => { },
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
        on: () => () => { },
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
