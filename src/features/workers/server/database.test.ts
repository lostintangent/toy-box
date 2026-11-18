import { describe, expect, test } from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";

import { createWorker, WorkerDatabase } from "./database";

describe("worker ownership", () => {
  test("owner reads select one channel without exposing another's Workers", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
    for (const channelId of ["a", "b"]) {
      await store.create({
        type: "channel",
        channelId,
        sessionId: channelId,
        createdAt: new Date(0).toISOString(),
        ephemeral: false,
        name: "Reviewer",
      });
    }
    const owner = { type: "channel", channelId: "a" } as const;
    expect((await store.list(owner)).map((worker) => worker.sessionId)).toEqual(["a"]);
    expect(await store.get("b", owner)).toBeNull();
    expect((await store.get("b", "channel"))?.name).toBe("Reviewer");
  });

  test("detail updates preserve omitted fields and replace or clear opaque metadata", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
    const worker = {
      type: "inbox" as const,
      sessionId: "result",
      name: "Initial",
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
      metadata: { message: "First", artifact: "report.md" },
    };
    await store.create(worker);
    await store.update(worker.sessionId, { name: "Renamed" });
    expect(await store.get(worker.sessionId, "inbox")).toEqual({ ...worker, name: "Renamed" });
    await store.update(worker.sessionId, { metadata: { message: "Second" } });
    expect(await store.get(worker.sessionId, "inbox")).toEqual({
      ...worker,
      name: "Renamed",
      metadata: { message: "Second" },
    });
    expect(
      await store.initializeMetadata(worker.sessionId, "inbox", { error: "Late failure" }),
    ).toBe(false);
    await store.update(worker.sessionId, { metadata: undefined });
    expect((await store.get(worker.sessionId, "inbox"))?.metadata).toBeUndefined();
    expect(await store.update("missing", { name: "Missing" })).toBe(false);
  });

  test("initializes only absent metadata for the matching owner", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
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
    const store = new WorkerDatabase(await openTestDatabase());
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
    const db = await openTestDatabase();
    const store = new WorkerDatabase(db);
    await store.create({
      type: "inbox",
      sessionId: "valid-json",
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
      metadata: { message: "Keep this" },
    });
    await expect(
      (async () => {
        await db`UPDATE workers SET metadata = ${"{invalid"} WHERE session_id = 'valid-json'`;
      })(),
    ).rejects.toThrow();
    expect((await store.get("valid-json"))?.metadata).toEqual({ message: "Keep this" });
  });

  test("lists worker session ids for a specific parent", async () => {
    const store = new WorkerDatabase(await openTestDatabase());

    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker-a",
      parentSessionId: "toy-box-parent-a",
      ephemeral: false,
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker-b",
      parentSessionId: "toy-box-parent-b",
      ephemeral: true,
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-worker-c",
      ephemeral: true,
      file: { kind: "session", sessionId: "toy-box-parent-a", path: "notes.md" },
    });

    expect(await store.listChildIds("toy-box-parent-a")).toEqual([
      "toy-box-worker-a",
      "toy-box-worker-c",
    ]);
  });

  test("round-trips owner details, names, and metadata", async () => {
    const store = new WorkerDatabase(await openTestDatabase());

    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "channel",
      sessionId: "toy-box-channel-worker",
      channelId: "channel-a",
      ephemeral: false,
      name: "Critic",
      metadata: { seenThrough: 4 },
    });

    expect(await store.get("toy-box-file-worker")).toEqual({
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
      ephemeral: true,
      name: "Editor",
      metadata: { task: "Review notes" },
    });
    expect(await store.get("toy-box-channel-worker")).toEqual({
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
    const store = new WorkerDatabase(await openTestDatabase());

    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "file",
      sessionId: "toy-box-file-worker",
      ephemeral: true,
      file: { kind: "session", sessionId: "toy-box-parent", path: "notes.md" },
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: "toy-box-app-worker",
      appId: "app-a",
      ephemeral: false,
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-session-worker",
      parentSessionId: "toy-box-parent",
      ephemeral: true,
    });
    expect(await store.listEphemeralIds()).toEqual([
      "toy-box-file-worker",
      "toy-box-session-worker",
    ]);
  });

  test("deletes workers and treats missing records as a no-op", async () => {
    const store = new WorkerDatabase(await openTestDatabase());

    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: "toy-box-worker",
      parentSessionId: "toy-box-parent",
      ephemeral: false,
    });
    await store.delete("toy-box-worker");
    await store.delete("toy-box-worker");

    expect(await store.get("toy-box-worker")).toBeNull();
  });
});
