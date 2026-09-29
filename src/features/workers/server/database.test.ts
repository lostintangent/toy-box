import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";

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
  getWorkerSessionIdsForApp,
  getWorkerSessionIdsForParent,
  registerWorkerSession,
  unregisterWorkerSession,
  WorkerDatabase,
  createWorker,
} = await import("./database");

const { getWorker, listWorkers, updateWorker, initializeWorkerMetadata } = await import("./index");

async function openWorkersTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

describe("worker ownership", () => {
  test("public owner reads select one channel without exposing another's Workers", async () => {
    await openWorkersTestDatabase();
    for (const channelId of ["a", "b"]) {
      await registerWorkerSession({
        type: "channel",
        channelId,
        sessionId: channelId,
        createdAt: new Date(0).toISOString(),
        ephemeral: false,
        name: "Reviewer",
      });
    }
    const owner = { type: "channel", channelId: "a" } as const;
    expect((await listWorkers(owner)).map((worker) => worker.sessionId)).toEqual(["a"]);
    expect(await getWorker("b", owner)).toBeNull();
    expect((await getWorker("b", "channel"))?.name).toBe("Reviewer");
  });

  test("public detail updates preserve omitted fields and replace or clear opaque metadata", async () => {
    await openWorkersTestDatabase();
    const worker = {
      type: "inbox" as const,
      sessionId: "result",
      name: "Initial",
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
      metadata: { message: "First", artifact: "report.md" },
    };
    await registerWorkerSession(worker);
    await updateWorker(worker.sessionId, { name: "Renamed" });
    expect(await getWorker(worker.sessionId, "inbox")).toEqual({ ...worker, name: "Renamed" });
    await updateWorker(worker.sessionId, { metadata: { message: "Second" } });
    expect(await getWorker(worker.sessionId, "inbox")).toEqual({
      ...worker,
      name: "Renamed",
      metadata: { message: "Second" },
    });
    expect(
      await initializeWorkerMetadata(worker.sessionId, "inbox", { error: "Late failure" }),
    ).toBe(false);
    await updateWorker(worker.sessionId, { metadata: undefined });
    expect((await getWorker(worker.sessionId, "inbox"))?.metadata).toBeUndefined();
    await expect(updateWorker("missing", { name: "Missing" })).rejects.toThrow("Worker not found");
  });

  test("initializes only absent metadata for the matching owner", async () => {
    await openWorkersTestDatabase();
    const store = new WorkerDatabase(currentDb!);
    const worker = {
      type: "inbox" as const,
      sessionId: "initialize",
      createdAt: new Date(0).toISOString(),
      ephemeral: false as const,
    };
    await store.create(worker);
    expect(await store.initializeMetadata(worker.sessionId, "app", { error: "Wrong owner" })).toBe(
      false,
    );
    expect(
      await store.initializeMetadata(worker.sessionId, "inbox", { error: "Interrupted" }),
    ).toBe(true);
    expect(
      await store.initializeMetadata(worker.sessionId, "inbox", { error: "Later failure" }),
    ).toBe(false);
    expect((await store.get(worker.sessionId))?.metadata).toEqual({ error: "Interrupted" });
    // JSON null is present metadata, distinct from an empty SQL column.
    await store.update(worker.sessionId, { metadata: null });
    expect(await store.initializeMetadata(worker.sessionId, "inbox", { error: "Unreadable" })).toBe(
      false,
    );
    expect((await store.get(worker.sessionId))?.metadata).toBeNull();
  });

  test("bounds construction and metadata updates before changing the stored record", async () => {
    await openWorkersTestDatabase();
    const store = new WorkerDatabase(currentDb!);
    const maximum = "é".repeat((SMALL_JSON_MAX_BYTES - 2) / 2);
    const oversized = `${maximum}é`;
    const worker = {
      type: "inbox" as const,
      sessionId: "bounded-metadata",
      createdAt: new Date(0).toISOString(),
      ephemeral: false as const,
    };
    await store.create({ ...worker, metadata: maximum });
    expect((await store.get(worker.sessionId))?.metadata).toBe(maximum);

    expect(() => createWorker({ type: "inbox", ephemeral: false, metadata: oversized })).toThrow(
      String(SMALL_JSON_MAX_BYTES),
    );
    await expect(
      store.update(worker.sessionId, { name: "Changed", metadata: oversized }),
    ).rejects.toThrow(String(SMALL_JSON_MAX_BYTES));
    await expect(store.initializeMetadata(worker.sessionId, "inbox", oversized)).rejects.toThrow(
      String(SMALL_JSON_MAX_BYTES),
    );

    expect(await store.get(worker.sessionId)).toEqual({ ...worker, metadata: maximum });
  });

  test("rejects malformed JSON at the SQLite boundary", async () => {
    await openWorkersTestDatabase();
    await registerWorkerSession({
      type: "inbox",
      sessionId: "valid-json",
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
      metadata: { message: "Keep this" },
    });
    await expect(
      (async () => {
        await currentDb!`UPDATE workers SET metadata = ${"{invalid"} WHERE session_id = 'valid-json'`;
      })(),
    ).rejects.toThrow();
    expect((await getPersistedWorker("valid-json"))?.metadata).toEqual({ message: "Keep this" });
  });

  test("lists worker session ids for a specific parent", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker-a",
      parentSessionId: "toy-box-parent-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker-b",
      parentSessionId: "toy-box-parent-b",
      ephemeral: true,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
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
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "channel",
      sessionId: "toy-box-channel-worker",
      channelId: "channel-a",
      ephemeral: false,
      name: "Critic",
      metadata: { seenThrough: 4 },
    });

    expect(await getPersistedWorker("toy-box-file-worker")).toEqual({
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    expect(await getPersistedWorker("toy-box-channel-worker")).toEqual({
      createdAt: new Date(0).toISOString(),
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
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      ephemeral: true,
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: "toy-box-app-worker",
      appId: "app-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
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
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker",
      parentSessionId: "toy-box-parent",
      ephemeral: false,
    });
    await unregisterWorkerSession("toy-box-worker");
    await unregisterWorkerSession("toy-box-worker");

    expect(await getPersistedWorker("toy-box-worker")).toBeNull();
  });

  test("read paths no-op when the server-state database does not exist", async () => {
    expect(await getWorkerSessionIdsForParent("toy-box-parent")).toEqual([]);
    expect(await getWorkerSessionIdsForApp("app-a")).toEqual([]);
    expect(await getEphemeralWorkerSessionIds()).toEqual([]);
    expect(await getPersistedWorker("missing-worker")).toBeNull();
  });
});
