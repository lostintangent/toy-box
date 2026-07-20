import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type { Database } from "db0";
import { createTestDatabase } from "../database";

let currentDb: Database | undefined;

mock.module("../database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  getDisposableWorkerSessionIds,
  getWorkerSessionIds,
  getWorkerSessionIdsForParent,
  registerWorkerSession,
  unregisterWorkerSession,
} = await import("./workers");

async function openWorkersTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

describe("worker ownership", () => {
  test("lists worker session ids", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession("toy-box-worker-a", "toy-box-parent");
    await registerWorkerSession("toy-box-worker-b", "toy-box-parent");

    expect(await getWorkerSessionIds()).toEqual(["toy-box-worker-a", "toy-box-worker-b"]);
  });

  test("lists worker session ids for a specific parent", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession("toy-box-worker-a", "toy-box-parent-a");
    await registerWorkerSession("toy-box-worker-b", "toy-box-parent-b");
    await registerWorkerSession("toy-box-worker-c", "toy-box-parent-a");

    expect(await getWorkerSessionIdsForParent("toy-box-parent-a")).toEqual([
      "toy-box-worker-a",
      "toy-box-worker-c",
    ]);
  });

  test("keeps the first owner when a worker is registered twice", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession("toy-box-worker", "toy-box-parent-a");
    await registerWorkerSession("toy-box-worker", "toy-box-parent-b");

    expect(await getWorkerSessionIds()).toEqual(["toy-box-worker"]);
    const { rows } = await currentDb!.sql`
      SELECT parent_session_id FROM workers WHERE session_id = ${"toy-box-worker"}
    `;
    expect((rows as { parent_session_id: string }[])[0]?.parent_session_id).toBe(
      "toy-box-parent-a",
    );
  });

  test("makes workers disposable by default and retains them only when requested", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession("toy-box-disposable", "toy-box-parent");
    await registerWorkerSession("toy-box-retained", "toy-box-parent", true);

    expect(await getWorkerSessionIds()).toEqual(["toy-box-disposable", "toy-box-retained"]);
    expect(await getDisposableWorkerSessionIds()).toEqual(["toy-box-disposable"]);
  });

  test("unregisters workers and treats missing records as a no-op", async () => {
    await openWorkersTestDatabase();

    await registerWorkerSession("toy-box-worker", "toy-box-parent");
    await unregisterWorkerSession("toy-box-worker");
    await unregisterWorkerSession("toy-box-worker");

    expect(await getWorkerSessionIds()).toEqual([]);
  });

  test("read paths no-op when the server-state database does not exist", async () => {
    expect(await getWorkerSessionIds()).toEqual([]);
    expect(await getWorkerSessionIdsForParent("toy-box-parent")).toEqual([]);
    expect(await getDisposableWorkerSessionIds()).toEqual([]);
  });
});
