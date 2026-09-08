import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import * as workersModule from "./index";

const realWorkersModule = { ...workersModule };
type SpawnWorkerInput = Parameters<typeof workersModule.spawnSessionWorker>[0];

const spawnWorkerMock = mock(async (_input: SpawnWorkerInput) => ({
  sessionId: "toy-box-worker",
}));

mock.module("@workers/server", () => ({
  ...realWorkersModule,
  spawnSessionWorker: spawnWorkerMock,
}));

const { workerTools } = await import("./tools");

afterAll(() => {
  mock.module("@workers/server", () => realWorkersModule);
});

beforeEach(() => {
  spawnWorkerMock.mockClear();
});

describe("worker SDK tool", () => {
  test("spawns a retained child owned by the caller", async () => {
    const tool = workerTools.find((candidate) => candidate.name === "spawn_worker");
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
    expect(parsed).toEqual({ sessionId: "toy-box-worker", opened: true });
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      parentSessionId: "toy-box-caller",
      ephemeral: false,
      name: "Runtime reviewer",
      message: { content: "Review the runtime", model },
      directory: "/workspace",
      useWorktree: true,
    });
    expect(tool?.description).toContain("Retained children open as linked panes");
  });

  test("can make a child ephemeral", async () => {
    const tool = workerTools.find((candidate) => candidate.name === "spawn_worker");

    const result = await tool?.handler?.({ task: "Run once", ephemeral: true }, invocation());

    expect(JSON.parse(String(result))).toEqual({
      sessionId: "toy-box-worker",
      opened: false,
    });
    expect(spawnWorkerMock.mock.calls[0]?.[0].ephemeral).toBe(true);
  });
});

function invocation(): ToolInvocation {
  return {
    sessionId: "toy-box-caller",
    toolCallId: "tool-call",
    toolName: "spawn_worker",
    arguments: {},
  };
}
