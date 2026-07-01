import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type { CreateSessionOptions } from "@/functions/state/sessionCache";
import type { SessionStream } from "./stream";

function mockBroadcast(overrides: Record<string, unknown> = {}) {
  mock.module("./broadcast", () => ({
    emitSessionIdle: () => {},
    emitSessionRead: () => {},
    emitSessionRunning: () => {},
    emitSessionUnread: () => {},
    updateSessionSummary: () => {},
    ...overrides,
  }));
}

function mockSessionCache(overrides: Record<string, unknown>) {
  mock.module("@/functions/state/sessionCache", () => ({
    createSession: async () => {
      throw new Error("createSession mock was not provided");
    },
    deleteSession: async () => {},
    getOrResumeSession: async () => {
      throw new Error("getOrResumeSession mock was not provided");
    },
    getCachedOrResumeSession: async () => {
      throw new Error("getCachedOrResumeSession mock was not provided");
    },
    evictCachedSessionIfStale: () => false,
    ...overrides,
  }));
}

describe("sessionLauncher", () => {
  test("createManagedSession creates the session with the requested options and summary", async () => {
    const fakeSession = {
      send: async () => {},
      on: () => () => {},
    } as unknown as CopilotSession;
    const fakeStream = {
      startTurn: () => {},
      finishStream: () => {},
      detach: () => {},
    } as unknown as SessionStream;
    const createSessionMock = mock(
      async (_sessionId: string, _options?: CreateSessionOptions) => fakeSession,
    );
    const updateSessionSummaryMock = mock(
      (_sessionId: string, _summary: string, _options?: { replace?: boolean }) => {},
    );
    const getOrCreateStreamMock = mock(() => fakeStream);

    mockSessionCache({
      createSession: createSessionMock,
      deleteSession: async () => {},
    });
    mockBroadcast({
      updateSessionSummary: updateSessionSummaryMock,
    });
    const streamModule = await import("./stream");
    const originalGetOrCreate = streamModule.SessionStream.getOrCreate;
    streamModule.SessionStream.getOrCreate = getOrCreateStreamMock as typeof originalGetOrCreate;
    onTestFinished(() => {
      streamModule.SessionStream.getOrCreate = originalGetOrCreate;
      mock.restore();
    });

    const { createManagedSession } = await import("./sessionLauncher");
    const created = await createManagedSession({
      sessionId: "toy-box-launcher-test",
      modelConfiguration: { model: "gpt-5" },
      directory: "/repo/app",
      summary: "Automation title",
      useWorktree: false,
      initialContext: {
        workingDirectory: "/repo/app",
        gitRoot: "/repo",
        repository: "owner/repo",
        branch: "main",
      },
    });

    expect(created.sessionId).toBe("toy-box-launcher-test");
    expect(created.stream).toBe(fakeStream);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith("toy-box-launcher-test", {
      modelConfiguration: { model: "gpt-5" },
      directory: "/repo/app",
      useWorktree: false,
      initialContext: {
        workingDirectory: "/repo/app",
        gitRoot: "/repo",
        repository: "owner/repo",
        branch: "main",
      },
    });
    expect(updateSessionSummaryMock).toHaveBeenCalledTimes(1);
    expect(updateSessionSummaryMock).toHaveBeenCalledWith(
      "toy-box-launcher-test",
      "Automation title",
      {
        replace: true,
      },
    );
    expect(getOrCreateStreamMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateStreamMock).toHaveBeenCalledWith("toy-box-launcher-test", fakeSession, {
      modelConfiguration: { model: "gpt-5" },
    });
  });

  test("createAndStartSession closes the stream when sending the initial prompt fails", async () => {
    const sendMock = mock(async (_message: { prompt: string }) => {});
    sendMock.mockRejectedValue(new Error("boom"));
    const startTurnMock = mock(() => {});
    const closeMock = mock(() => {});

    mockSessionCache({
      createSession: async () =>
        ({
          send: sendMock,
          on: () => () => {},
        }) as unknown as CopilotSession,
      deleteSession: async () => {},
    });
    mockBroadcast();
    const streamModule = await import("./stream");
    const originalGetOrCreate = streamModule.SessionStream.getOrCreate;
    streamModule.SessionStream.getOrCreate = (() =>
      ({
        startTurn: startTurnMock,
        close: closeMock,
      }) as unknown as SessionStream) as typeof originalGetOrCreate;
    onTestFinished(() => {
      streamModule.SessionStream.getOrCreate = originalGetOrCreate;
      mock.restore();
    });

    const { createAndStartSession } = await import("./sessionLauncher");

    await expect(
      createAndStartSession({
        sessionId: "toy-box-failing",
        prompt: "Kick off a failing companion session",
      }),
    ).rejects.toThrow("boom");

    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Kick off a failing companion session",
      }),
    );
    expect(sendMock).toHaveBeenCalledWith({ prompt: "Kick off a failing companion session" });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test("createManagedSession forwards parent session metadata", async () => {
    const fakeSession = {
      send: async () => {},
      on: () => () => {},
    } as unknown as CopilotSession;
    const fakeStream = {
      startTurn: () => {},
    } as unknown as SessionStream;
    const createSessionMock = mock(
      async (_sessionId: string, _options?: CreateSessionOptions) => fakeSession,
    );

    mockSessionCache({
      createSession: createSessionMock,
      deleteSession: async () => {},
    });
    mockBroadcast();
    const streamModule = await import("./stream");
    const originalGetOrCreate = streamModule.SessionStream.getOrCreate;
    streamModule.SessionStream.getOrCreate = (() => fakeStream) as typeof originalGetOrCreate;
    onTestFinished(() => {
      streamModule.SessionStream.getOrCreate = originalGetOrCreate;
      mock.restore();
    });

    const { createManagedSession } = await import("./sessionLauncher");
    await createManagedSession({
      sessionId: "toy-box-child",
      parentSessionId: "toy-box-parent",
    });

    expect(createSessionMock).toHaveBeenCalledWith("toy-box-child", {
      parentSessionId: "toy-box-parent",
    });
  });
});
