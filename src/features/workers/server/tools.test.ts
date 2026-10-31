import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as workersModule from "./index";

const realWorkersModule = { ...workersModule };
type SpawnWorkerInput = Parameters<typeof workersModule.spawnWorker>[0];

const spawnWorkerMock = mock(async (_input: SpawnWorkerInput) => ({
  sessionId: "toy-box-worker",
}));

mock.module("@workers/server", () => ({
  ...realWorkersModule,
  spawnWorker: spawnWorkerMock,
}));

const { workerTools } = await import("./tools");

afterAll(() => {
  mock.module("@workers/server", () => realWorkersModule);
});

beforeEach(() => {
  spawnWorkerMock.mockClear();
});

describe("worker SDK tool", () => {
  test("spawns a retained child owned by the caller without opening it", async () => {
    const tool = workerTools.find((candidate) => candidate.name === "spawn_worker");
    const model = { provider: "copilot", name: "claude-sonnet-4.5" };

    const result = await tool?.handler?.(
      {
        task: "Review the runtime",
        name: "Runtime reviewer",
        model,
        directory: "/workspace",
        useWorktree: true,
      },
      "toy-box-caller",
    );

    expect(JSON.parse(String(result))).toEqual({ sessionId: "toy-box-worker" });
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      owner: { type: "session", parentSessionId: "toy-box-caller" },
      retention: "durable",
      name: "Runtime reviewer",
      message: { content: "Review the runtime", model },
      location: { directory: "/workspace", useWorktree: true },
    });
  });

  test("can make a child ephemeral", async () => {
    const tool = workerTools.find((candidate) => candidate.name === "spawn_worker");

    const result = await tool?.handler?.({ task: "Run once", ephemeral: true }, "toy-box-caller");

    expect(JSON.parse(String(result))).toEqual({
      sessionId: "toy-box-worker",
    });
    expect(spawnWorkerMock.mock.calls[0]?.[0].retention).toBe("ephemeral");
  });
});
