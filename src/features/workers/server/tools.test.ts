import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import * as workersModule from "./index";

const realWorkersModule = { ...workersModule };
type SpawnWorkerInput = Parameters<typeof workersModule.spawnWorker>[0];

const spawnWorkerMock = mock(async (input: SpawnWorkerInput) => ({
  sessionId: input.worker.sessionId,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));

mock.module("@workers/server", () => ({
  ...realWorkersModule,
  spawnWorker: spawnWorkerMock,
}));

const { getSessionTools } = await import("@/server/sessionTools");

afterAll(() => {
  mock.module("@workers/server", () => realWorkersModule);
});

beforeEach(() => {
  spawnWorkerMock.mockClear();
});

describe("worker SDK tool", () => {
  test("spawns a durable child owned by the caller", async () => {
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
      invocation(),
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
    expect(tool?.description).toContain("Durable children open as linked panes");
  });

  test("can make a child ephemeral", async () => {
    const tool = getSessionTools("standard").find(
      (candidate) => candidate.name === "create_worker_session",
    );

    const result = await tool?.handler?.({ task: "Run once", ephemeral: true }, invocation());

    expect(JSON.parse(String(result))).toEqual({
      sessionId: expect.stringMatching(/^toy-box-/),
      opened: false,
    });
    expect(spawnWorkerMock.mock.calls[0]?.[0].worker.ephemeral).toBe(true);
  });
});

function invocation(): ToolInvocation {
  return {
    sessionId: "toy-box-caller",
    toolCallId: "tool-call",
    toolName: "create_worker_session",
    arguments: {},
  };
}
