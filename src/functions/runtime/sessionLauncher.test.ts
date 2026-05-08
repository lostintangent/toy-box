import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type { CreateSessionOptions } from "@/functions/state/sessionCache";
import type { SessionStream } from "./stream";

describe("sessionLauncher", () => {
  test("createManagedSession creates the session with the requested options and summary", async () => {
    const fakeSession = {
      send: async () => { },
      on: () => () => { },
    } as unknown as CopilotSession;
    const fakeStream = {
      startTurn: () => { },
      markSendFailure: () => { },
      detach: () => { },
    } as unknown as SessionStream;
    const createSessionMock = mock(
      async (_sessionId: string, _options?: CreateSessionOptions) => fakeSession,
    );
    const updateSessionSummaryMock = mock(
      (_sessionId: string, _summary: string, _options?: { replace?: boolean }) => { },
    );
    const getOrCreateStreamMock = mock(() => fakeStream);

    mock.module("@/functions/state/sessionCache", () => ({
      createSession: createSessionMock,
      deleteSession: async () => { },
    }));
    mock.module("./broadcast", () => ({
      updateSessionSummary: updateSessionSummaryMock,
    }));
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
      model: "gpt-5",
      directory: "/repo/app",
      summary: "Automation title",
      useWorktree: false,
      initialContext: {
        cwd: "/repo/app",
        gitRoot: "/repo",
        repository: "owner/repo",
        branch: "main",
      },
    });

    expect(created.sessionId).toBe("toy-box-launcher-test");
    expect(created.stream).toBe(fakeStream);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith("toy-box-launcher-test", {
      model: "gpt-5",
      directory: "/repo/app",
      useWorktree: false,
      initialContext: {
        cwd: "/repo/app",
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
      model: "gpt-5",
    });
  });

  test("createAndStartSession cleans up the stream when sending the initial prompt fails", async () => {
    const sendMock = mock(async (_message: { prompt: string }) => { });
    sendMock.mockRejectedValue(new Error("boom"));
    const startTurnMock = mock((_prompt: string) => { });
    const markSendFailureMock = mock(() => { });
    const detachMock = mock(() => { });

    mock.module("@/functions/state/sessionCache", () => ({
      createSession: async () =>
        ({
          send: sendMock,
          on: () => () => { },
        }) as unknown as CopilotSession,
      deleteSession: async () => { },
    }));
    mock.module("./broadcast", () => ({
      updateSessionSummary: () => { },
    }));
    const streamModule = await import("./stream");
    const originalGetOrCreate = streamModule.SessionStream.getOrCreate;
    streamModule.SessionStream.getOrCreate = (() =>
      ({
        startTurn: startTurnMock,
        markSendFailure: markSendFailureMock,
        detach: detachMock,
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

    expect(startTurnMock).toHaveBeenCalledWith("Kick off a failing companion session");
    expect(sendMock).toHaveBeenCalledWith({ prompt: "Kick off a failing companion session" });
    expect(markSendFailureMock).toHaveBeenCalledTimes(1);
    expect(detachMock).toHaveBeenCalledTimes(1);
  });
});
