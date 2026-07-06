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

const { getAllSessionWorktrees, getSessionWorktree, upsertSessionWorktree } =
  await import("./worktreeMetadata");

async function openWorktreeMetadataTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

describe("worktree metadata", () => {
  test("read paths no-op when the app database does not exist", async () => {
    expect(await getSessionWorktree("toy-box-session")).toBeNull();
    expect(await getAllSessionWorktrees()).toEqual({});
  });

  test("persists worktree metadata after the database exists", async () => {
    await openWorktreeMetadataTestDatabase();

    await upsertSessionWorktree("toy-box-session", {
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
      linesAdded: 12,
      linesRemoved: 3,
    });

    expect(await getSessionWorktree("toy-box-session")).toEqual({
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
      linesAdded: 12,
      linesRemoved: 3,
    });
    expect(await getAllSessionWorktrees()).toEqual({
      "toy-box-session": {
        path: "/tmp/toy-box-session",
        branch: "toy-box/session",
        baseBranch: "main",
        linesAdded: 12,
        linesRemoved: 3,
      },
    });
  });

  test("stats patches preserve required worktree identity fields", async () => {
    await openWorktreeMetadataTestDatabase();

    await upsertSessionWorktree("toy-box-session", {
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
    });
    await upsertSessionWorktree("toy-box-session", {
      linesAdded: 12,
      linesRemoved: 3,
    });

    expect(await getSessionWorktree("toy-box-session")).toEqual({
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
      linesAdded: 12,
      linesRemoved: 3,
    });
  });

  test("database requires complete worktree identity fields", async () => {
    await openWorktreeMetadataTestDatabase();

    await expect(currentDb!.sql`
      INSERT INTO worktrees (session_id)
      VALUES (${"toy-box-session"})
    `).rejects.toThrow();
  });

  test("rejects partial required worktree identity updates", async () => {
    await openWorktreeMetadataTestDatabase();

    await expect(
      upsertSessionWorktree("toy-box-session", {
        path: "/tmp/toy-box-session",
      }),
    ).rejects.toThrow("Worktree path, branch, and baseBranch must be updated together");
  });
});
