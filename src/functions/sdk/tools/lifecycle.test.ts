import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import * as streamModule from "@/functions/runtime/stream";
import * as workersModule from "@/functions/workers/supervisor";

const realStreamModule = { ...streamModule };
const realWorkersModule = { ...workersModule };

type CreateSessionArguments = Parameters<typeof streamModule.createSession>;
type SpawnWorkerInput = Parameters<typeof workersModule.spawnWorker>[0];

const createSessionMock = mock(async (..._args: CreateSessionArguments) => ({
  disposition: "started" as const,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));
const spawnWorkerMock = mock(async (input: SpawnWorkerInput) => ({
  sessionId: input.worker.sessionId,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));
mock.module("@/functions/runtime/stream", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
}));
mock.module("@/functions/workers/supervisor", () => ({
  ...realWorkersModule,
  spawnWorker: spawnWorkerMock,
}));

const { getSessionTools } = await import("./index");

afterAll(() => {
  mock.module("@/functions/runtime/stream", () => realStreamModule);
  mock.module("@/functions/workers/supervisor", () => realWorkersModule);
});

beforeEach(() => {
  createSessionMock.mockClear();
  spawnWorkerMock.mockClear();
});

describe("SDK lifecycle tools", () => {
  test("create_worker_session spawns a durable child owned by the caller", async () => {
    const tool = getSessionTools("standard").find(
      (candidate) => candidate.name === "create_worker_session",
    );
    const model = { name: "claude-sonnet-4.5" };

    const result = await tool?.handler?.(
      {
        task: "Review the runtime",
        name: "Runtime reviewer",
        model,
        directory: "/workspace",
        useWorktree: true,
      },
      invocation("create_worker_session"),
    );

    const parsed = JSON.parse(String(result)) as { sessionId: string; opened: boolean };
    expect(parsed).toEqual({ sessionId: expect.stringMatching(/^toy-box-/), opened: true });
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      worker: {
        type: "session",
        sessionId: parsed.sessionId,
        parentSessionId: "toy-box-caller",
        ephemeral: false,
        name: "Runtime reviewer",
      },
      message: { content: "Review the runtime", model },
      directory: "/workspace",
      useWorktree: true,
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(tool?.description).toContain("Durable children open as linked panes");
  });

  test("create_worker_session can make a child ephemeral", async () => {
    const tool = getSessionTools("standard").find(
      (candidate) => candidate.name === "create_worker_session",
    );

    const result = await tool?.handler?.(
      { task: "Run once", ephemeral: true },
      invocation("create_worker_session"),
    );

    expect(JSON.parse(String(result))).toEqual({
      sessionId: expect.stringMatching(/^toy-box-/),
      opened: false,
    });
    expect(spawnWorkerMock.mock.calls[0]?.[0].worker.ephemeral).toBe(true);
  });

  test("create_session creates a standard session without inherited defaults or a worker owner", async () => {
    const tool = getSessionTools("hyper").find((candidate) => candidate.name === "create_session");

    const result = await tool?.handler?.(
      { prompt: "Start a durable investigation" },
      invocation("create_session"),
    );

    const { sessionId, opened } = JSON.parse(String(result)) as {
      sessionId: string;
      opened: boolean;
    };
    expect(sessionId).toStartWith("toy-box-");
    expect(opened).toBe(false);
    expect(createSessionMock).toHaveBeenCalledWith(
      sessionId,
      { content: "Start a durable investigation", model: undefined },
      {
        directory: undefined,
        sessionType: "standard",
        useWorktree: false,
      },
    );
    expect(spawnWorkerMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[0]?.[2]).not.toHaveProperty("worker");
  });

  test("create_session honors explicit execution options and can open the new session", async () => {
    const tool = getSessionTools("hyper").find((candidate) => candidate.name === "create_session");
    const model = { name: "claude-sonnet-4.5" };

    const result = await tool?.handler?.(
      {
        prompt: "Work elsewhere",
        model,
        directory: "/other",
        useWorktree: true,
        open: true,
      },
      invocation("create_session"),
    );

    expect(JSON.parse(String(result))).toEqual({
      sessionId: expect.stringMatching(/^toy-box-/),
      opened: true,
    });
    expect(createSessionMock.mock.calls[0]?.[1]).toEqual({ content: "Work elsewhere", model });
    expect(createSessionMock.mock.calls[0]?.[2]).toEqual({
      directory: "/other",
      sessionType: "standard",
      useWorktree: true,
    });
  });
});

function invocation(toolName: string): ToolInvocation {
  return {
    sessionId: "toy-box-caller",
    toolCallId: "tool-call",
    toolName,
    arguments: {},
  };
}
