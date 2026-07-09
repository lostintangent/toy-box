import { beforeEach, describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database } from "db0";
import { createTestDatabase } from "../database";
import type { SessionWorktree } from "@/types";

let currentDb: Database | undefined;
let gitCalls: Array<{ directory: string; args: string[] }> = [];
let runGit = async (_directory: string, _args: string[]): Promise<string> => {
  throw new Error("Not a Git repository");
};

mock.module("../database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { createSessionWorktree, deleteSessionWorktree, getAllSessionWorktrees } =
  await import("./worktrees");

async function openWorktreeTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

async function insertWorktree(sessionId: string, worktree: SessionWorktree): Promise<void> {
  await currentDb!.sql`
    INSERT INTO worktrees (
      session_id,
      worktree_path,
      worktree_branch,
      worktree_base_branch,
      lines_added,
      lines_removed
    )
    VALUES (
      ${sessionId},
      ${worktree.path},
      ${worktree.branch},
      ${worktree.baseBranch},
      ${worktree.linesAdded ?? null},
      ${worktree.linesRemoved ?? null}
    )
  `;
}

describe("session worktrees", () => {
  beforeEach(() => {
    gitCalls = [];
    runGit = async () => {
      throw new Error("Not a Git repository");
    };
    const execFile = spyOn(childProcess, "execFile").mockImplementation(((
      _file: string,
      command: string[],
      _options: { encoding: string },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const [, directory, ...args] = command;
      gitCalls.push({ directory: directory!, args });
      void runGit(directory!, args).then(
        (stdout) => callback(null, stdout, ""),
        (error: unknown) =>
          callback(error instanceof Error ? error : new Error(String(error)), "", ""),
      );
      return undefined as never;
    }) as unknown as typeof childProcess.execFile);
    onTestFinished(() => execFile.mockRestore());
  });

  test("creates the Git worktree and its record as one operation", async () => {
    await openWorktreeTestDatabase();
    runGit = async (_directory, args) => {
      if (args.join(" ") === "rev-parse --show-toplevel") return "/source";
      if (args.join(" ") === "remote get-url origin") {
        return "git@github.com:openai/toy-box.git";
      }
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return "main";
      if (args[0] === "worktree" && args[1] === "add") return "";
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    };

    const sessionId = "toy-box-worktree-test";
    const path = join(homedir(), ".toy-box", "worktrees", "worktree-tes");
    await expect(createSessionWorktree(sessionId, "/source/subdirectory")).resolves.toEqual({
      worktree: {
        path,
        branch: "toy-box/worktree-tes",
        baseBranch: "main",
      },
      sourceGitRoot: "/source",
      sourceRepository: "openai/toy-box",
    });
    expect(await getAllSessionWorktrees()).toEqual({
      [sessionId]: {
        path,
        branch: "toy-box/worktree-tes",
        baseBranch: "main",
        linesAdded: undefined,
        linesRemoved: undefined,
      },
    });
  });

  test("reads persisted worktree state", async () => {
    await openWorktreeTestDatabase();
    await insertWorktree("toy-box-session", {
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
      linesAdded: 12,
      linesRemoved: 3,
    });

    const expected = {
      path: "/tmp/toy-box-session",
      branch: "toy-box/session",
      baseBranch: "main",
      linesAdded: 12,
      linesRemoved: 3,
    };
    expect(await getAllSessionWorktrees()).toEqual({ "toy-box-session": expected });
  });

  test("deletion releases the Git worktree before removing its record", async () => {
    await openWorktreeTestDatabase();
    await insertWorktree("toy-box-session", {
      path: "/worktrees/session",
      branch: "toy-box/session",
      baseBranch: "main",
    });
    runGit = async (_directory, args) => {
      if (args.join(" ") === "rev-parse --path-format=absolute --git-common-dir") {
        return "/source/.git";
      }
      if (args[0] === "worktree" && args[1] === "remove") return "";
      if (args[0] === "branch" && args[1] === "-D") return "";
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    };

    await deleteSessionWorktree("toy-box-session");

    expect(gitCalls).toEqual([
      {
        directory: "/worktrees/session",
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      },
      {
        directory: "/source",
        args: ["worktree", "remove", "--force", "/worktrees/session"],
      },
      { directory: "/source", args: ["branch", "-D", "toy-box/session"] },
    ]);
    expect(await getAllSessionWorktrees()).toEqual({});
  });

  test("deletion removes the record when the Git worktree is already gone", async () => {
    await openWorktreeTestDatabase();
    await insertWorktree("toy-box-session", {
      path: `/tmp/toy-box-missing-worktree-${crypto.randomUUID()}`,
      branch: "toy-box/session",
      baseBranch: "main",
    });

    await deleteSessionWorktree("toy-box-session");

    expect(await getAllSessionWorktrees()).toEqual({});
  });

  test("does not create a worktree outside a Git repository", async () => {
    const directory = `/tmp/toy-box-missing-repository-${crypto.randomUUID()}`;
    expect(await createSessionWorktree("toy-box-session", directory)).toBeUndefined();
  });

  test("read paths no-op when the server-state database does not exist", async () => {
    expect(await getAllSessionWorktrees()).toEqual({});
  });

  test("database requires complete worktree identity fields", async () => {
    await openWorktreeTestDatabase();

    await expect(currentDb!.sql`
      INSERT INTO worktrees (session_id)
      VALUES (${"toy-box-session"})
    `).rejects.toThrow();
  });
});
