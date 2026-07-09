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

const { getChildSessionIds, getChildSessionIdsForParent, linkChildSession, unlinkChildSession } =
  await import("./children");

async function openChildSessionsTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

describe("child session links", () => {
  test("lists child session ids", async () => {
    await openChildSessionsTestDatabase();

    await linkChildSession("toy-box-child-a", "toy-box-parent");
    await linkChildSession("toy-box-child-b", "toy-box-parent");

    expect(await getChildSessionIds()).toEqual(["toy-box-child-a", "toy-box-child-b"]);
  });

  test("lists child session ids for a specific parent", async () => {
    await openChildSessionsTestDatabase();

    await linkChildSession("toy-box-child-a", "toy-box-parent-a");
    await linkChildSession("toy-box-child-b", "toy-box-parent-b");
    await linkChildSession("toy-box-child-c", "toy-box-parent-a");

    expect(await getChildSessionIdsForParent("toy-box-parent-a")).toEqual([
      "toy-box-child-a",
      "toy-box-child-c",
    ]);
  });

  test("keeps the first parent when a child is linked twice", async () => {
    await openChildSessionsTestDatabase();

    await linkChildSession("toy-box-child", "toy-box-parent-a");
    await linkChildSession("toy-box-child", "toy-box-parent-b");

    expect(await getChildSessionIds()).toEqual(["toy-box-child"]);
    const { rows } = await currentDb!.sql`
      SELECT parent_session_id FROM child_sessions WHERE session_id = ${"toy-box-child"}
    `;
    expect((rows as { parent_session_id: string }[])[0]?.parent_session_id).toBe(
      "toy-box-parent-a",
    );
  });

  test("unlinks child sessions and treats missing links as a no-op", async () => {
    await openChildSessionsTestDatabase();

    await linkChildSession("toy-box-child", "toy-box-parent");
    await unlinkChildSession("toy-box-child");
    await unlinkChildSession("toy-box-child");

    expect(await getChildSessionIds()).toEqual([]);
  });

  test("read paths no-op when the server-state database does not exist", async () => {
    expect(await getChildSessionIds()).toEqual([]);
    expect(await getChildSessionIdsForParent("toy-box-parent")).toEqual([]);
  });
});
