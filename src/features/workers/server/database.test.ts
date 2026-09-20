import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  getEphemeralWorkerSessionIds,
  getPersistedWorker,
  getWorkerSessionParents,
  getWorkerSessionIdsForApp,
  getWorkerSessionIdsForParent,
  registerWorkerSession,
  unregisterWorkerSession,
} = await import("./database");

async function openWorkersTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

describe("worker ownership", () => {
  test("maps worker sessions to their parent sessions", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      type: "session",
      sessionId: "toy-box-worker-a",
      parentSessionId: "toy-box-parent",
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "app",
      sessionId: "toy-box-worker-b",
      appId: "app-a",
      ephemeral: true,
    });

    expect(await getWorkerSessionParents()).toEqual({
      "toy-box-worker-a": "toy-box-parent",
      "toy-box-worker-b": null,
    });
  });

  test("lists worker session ids for a specific parent", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      type: "session",
      sessionId: "toy-box-worker-a",
      parentSessionId: "toy-box-parent-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "session",
      sessionId: "toy-box-worker-b",
      parentSessionId: "toy-box-parent-b",
      ephemeral: true,
    });
    await registerWorkerSession({
      type: "file",
      sessionId: "toy-box-worker-c",
      ephemeral: true,
      file: { kind: "session", sessionId: "toy-box-parent-a", path: "notes.md" },
    });

    expect(await getWorkerSessionIdsForParent("toy-box-parent-a")).toEqual([
      "toy-box-worker-a",
      "toy-box-worker-c",
    ]);
  });

  test("round-trips owner details, names, and metadata", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    await registerWorkerSession({
      type: "channel",
      sessionId: "toy-box-channel-worker",
      channelId: "channel-a",
      ephemeral: false,
      name: "Critic",
      metadata: { seenThrough: 4 },
    });

    expect(await getPersistedWorker("toy-box-file-worker")).toEqual({
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    expect(await getPersistedWorker("toy-box-channel-worker")).toEqual({
      type: "channel",
      sessionId: "toy-box-channel-worker",
      channelId: "channel-a",
      ephemeral: false,
      name: "Critic",
      metadata: { seenThrough: 4 },
    });
  });

  test("selects ephemeral workers independently of their owner", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      type: "file",
      sessionId: "toy-box-file-worker",
      ephemeral: true,
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
    });
    await registerWorkerSession({
      type: "app",
      sessionId: "toy-box-app-worker",
      appId: "app-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "session",
      sessionId: "toy-box-session-worker",
      parentSessionId: "toy-box-parent",
      ephemeral: true,
    });
    expect(await getEphemeralWorkerSessionIds()).toEqual([
      "toy-box-file-worker",
      "toy-box-session-worker",
    ]);
    expect(await getWorkerSessionIdsForApp("app-a")).toEqual(["toy-box-app-worker"]);
  });

  test("unregisters workers and treats missing records as a no-op", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      type: "session",
      sessionId: "toy-box-worker",
      parentSessionId: "toy-box-parent",
      ephemeral: false,
    });
    await unregisterWorkerSession("toy-box-worker");
    await unregisterWorkerSession("toy-box-worker");

    expect(await getWorkerSessionParents()).toEqual({});
  });

  test("read paths no-op when the server-state database does not exist", async () => {
    expect(await getWorkerSessionParents()).toEqual({});
    expect(await getWorkerSessionIdsForParent("toy-box-parent")).toEqual([]);
    expect(await getWorkerSessionIdsForApp("app-a")).toEqual([]);
    expect(await getEphemeralWorkerSessionIds()).toEqual([]);
    expect(await getPersistedWorker("missing-worker")).toBeNull();
  });
});
