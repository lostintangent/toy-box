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

const { deleteChildSession, getChildSessionIds, getChildSessionIdsForParent, upsertChildSession } =
  await import("./childSessions");

async function openChildSessionsTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

describe("child session metadata", () => {
  test("read paths no-op when the app database does not exist", async () => {
    expect(await getChildSessionIds()).toEqual([]);
    expect(await getChildSessionIdsForParent("toy-box-parent")).toEqual([]);
  });

  test("lists child session ids", async () => {
    await openChildSessionsTestDatabase();

    await upsertChildSession("toy-box-child-a", "toy-box-parent");
    await upsertChildSession("toy-box-child-b", "toy-box-parent");

    expect(await getChildSessionIds()).toEqual(["toy-box-child-a", "toy-box-child-b"]);
  });

  test("keeps the first parent link when an id is inserted twice", async () => {
    await openChildSessionsTestDatabase();

    await upsertChildSession("toy-box-child", "toy-box-parent-a");
    await upsertChildSession("toy-box-child", "toy-box-parent-b");

    expect(await getChildSessionIds()).toEqual(["toy-box-child"]);
    const { rows } = await currentDb!.sql`
      SELECT parent_session_id FROM child_sessions WHERE session_id = ${"toy-box-child"}
    `;
    expect((rows as { parent_session_id: string }[])[0]?.parent_session_id).toBe(
      "toy-box-parent-a",
    );
  });

  test("lists child session ids for a specific parent", async () => {
    await openChildSessionsTestDatabase();

    await upsertChildSession("toy-box-child-a", "toy-box-parent-a");
    await upsertChildSession("toy-box-child-b", "toy-box-parent-b");
    await upsertChildSession("toy-box-child-c", "toy-box-parent-a");

    expect(await getChildSessionIdsForParent("toy-box-parent-a")).toEqual([
      "toy-box-child-a",
      "toy-box-child-c",
    ]);
  });

  test("deletes child session ids and treats missing rows as a no-op", async () => {
    await openChildSessionsTestDatabase();

    await upsertChildSession("toy-box-child", "toy-box-parent");
    await deleteChildSession("toy-box-child");
    await deleteChildSession("toy-box-child");

    expect(await getChildSessionIds()).toEqual([]);
  });
});
