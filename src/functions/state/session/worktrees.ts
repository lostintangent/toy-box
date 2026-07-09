// Session worktree state.
//
// A worktree is a session-owned resource whose Git checkout and database
// record must move together. This module owns that complete lifecycle so
// session callers never coordinate Git and persistence independently.

import * as childProcess from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDatabase } from "../database";
import type { SessionWorktree } from "@/types";

/** Create and persist a worktree for a session when its directory is a Git repository. */
export async function createSessionWorktree(
  sessionId: string,
  directory: string,
): Promise<
  | {
      worktree: SessionWorktree;
      sourceGitRoot: string;
      sourceRepository?: string;
    }
  | undefined
> {
  const sourceGitRoot = await detectGitRoot(directory);
  if (!sourceGitRoot) return undefined;

  const sourceRepository = await getRepositoryName(sourceGitRoot);
  const worktree = await createGitWorktree(sourceGitRoot, sessionId);

  try {
    await saveSessionWorktree(sessionId, worktree);
  } catch (error) {
    await cleanupGitWorktree(worktree).catch(console.error);
    throw error;
  }

  return { worktree, sourceGitRoot, sourceRepository };
}

/** Get every session worktree for session-list hydration. */
export async function getAllSessionWorktrees(): Promise<Record<string, SessionWorktree>> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return {};

  const { rows } = await db.sql`SELECT * FROM worktrees`;
  const worktrees: Record<string, SessionWorktree> = {};
  for (const row of rows as SessionWorktreeRow[]) {
    const worktree = toSessionWorktree(row);
    if (worktree) worktrees[row.session_id] = worktree;
  }
  return worktrees;
}

/** Release a session's Git worktree and its persisted record. */
export async function deleteSessionWorktree(sessionId: string): Promise<void> {
  const worktree = await getSessionWorktree(sessionId);
  if (worktree) await cleanupGitWorktree(worktree).catch(console.error);
  await deleteSessionWorktreeRecord(sessionId);
}

/** Merge a session's worktree into its base branch, then release it. */
export async function mergeSessionWorktree(sessionId: string): Promise<void> {
  await finishSessionWorktree(sessionId, mergeWorktreeBranch);
}

/** Apply a session's worktree to its base branch as uncommitted changes, then release it. */
export async function applySessionWorktree(sessionId: string): Promise<void> {
  await finishSessionWorktree(sessionId, applyWorktreeBranch);
}

async function finishSessionWorktree(
  sessionId: string,
  action: (gitRoot: string, worktree: SessionWorktree) => Promise<void>,
): Promise<void> {
  const worktree = await getSessionWorktree(sessionId);
  if (!worktree) return;

  const gitRoot = await detectGitRoot(worktree.path);
  if (!gitRoot) return;

  await action(gitRoot, worktree);
  await cleanupGitWorktree(worktree).catch(console.error);
  await deleteSessionWorktreeRecord(sessionId);
}

// Persistence

type SessionWorktreeRow = {
  session_id: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_base_branch: string | null;
  lines_added: number | null;
  lines_removed: number | null;
};

async function getSessionWorktree(sessionId: string): Promise<SessionWorktree | null> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return null;

  const { rows } = await db.sql`
    SELECT * FROM worktrees WHERE session_id = ${sessionId}
  `;
  const row = (rows as SessionWorktreeRow[])[0];
  return row ? toSessionWorktree(row) : null;
}

function toSessionWorktree(row: SessionWorktreeRow): SessionWorktree | null {
  if (!row.worktree_path || !row.worktree_branch || !row.worktree_base_branch) return null;

  return {
    path: row.worktree_path,
    branch: row.worktree_branch,
    baseBranch: row.worktree_base_branch,
    linesAdded: row.lines_added ?? undefined,
    linesRemoved: row.lines_removed ?? undefined,
  };
}

async function saveSessionWorktree(sessionId: string, worktree: SessionWorktree): Promise<void> {
  const db = await getAppDatabase();
  await db.sql`
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
    ON CONFLICT(session_id) DO UPDATE SET
      worktree_path = excluded.worktree_path,
      worktree_branch = excluded.worktree_branch,
      worktree_base_branch = excluded.worktree_base_branch,
      lines_added = excluded.lines_added,
      lines_removed = excluded.lines_removed
  `;
}

async function deleteSessionWorktreeRecord(sessionId: string): Promise<void> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return;
  await db.sql`DELETE FROM worktrees WHERE session_id = ${sessionId}`;
}

// Git mechanics

async function git(directory: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "git",
      ["-C", directory, ...args],
      { encoding: "utf-8" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

async function getRepositoryName(directory: string): Promise<string | undefined> {
  try {
    const url = await git(directory, "remote", "get-url", "origin");
    return url.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  } catch {
    return undefined;
  }
}

async function detectGitRoot(directory: string): Promise<string | null> {
  try {
    return await git(directory, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
}

async function createGitWorktree(gitRoot: string, sessionId: string): Promise<SessionWorktree> {
  const shortId = sessionId.replace(/^toy-box-/, "").slice(0, 12);
  const branch = `toy-box/${shortId}`;
  const path = join(homedir(), ".toy-box", "worktrees", shortId);
  const baseBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");

  await git(gitRoot, "worktree", "add", "-b", branch, path, "HEAD");
  return { path, branch, baseBranch };
}

async function cleanupGitWorktree(worktree: SessionWorktree): Promise<void> {
  const mainGitRoot = await detectMainGitRoot(worktree.path);
  if (!mainGitRoot) return;

  try {
    await git(mainGitRoot, "worktree", "remove", "--force", worktree.path);
  } catch (error) {
    console.error(`Failed to remove worktree at ${worktree.path}:`, error);
  }

  try {
    await git(mainGitRoot, "branch", "-D", worktree.branch);
  } catch (error) {
    console.error(`Failed to delete branch ${worktree.branch}:`, error);
  }
}

async function detectMainGitRoot(directory: string): Promise<string | null> {
  try {
    const commonDirectory = await git(
      directory,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    return dirname(commonDirectory);
  } catch {
    return null;
  }
}

async function mergeWorktreeBranch(gitRoot: string, worktree: SessionWorktree): Promise<void> {
  try {
    await git(gitRoot, "diff", "--quiet", `${worktree.baseBranch}...${worktree.branch}`);
    return;
  } catch {
    // A non-zero exit means there are changes to merge.
  }

  const originalBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");
  try {
    await git(gitRoot, "checkout", worktree.baseBranch);
    await git(
      gitRoot,
      "merge",
      "--no-ff",
      worktree.branch,
      "-m",
      `Merge session ${worktree.branch}`,
    );
  } catch (error) {
    try {
      await git(gitRoot, "merge", "--abort");
    } catch {
      // No merge may be in progress.
    }
    throw error;
  } finally {
    if (originalBranch !== worktree.baseBranch) {
      try {
        await git(gitRoot, "checkout", originalBranch);
      } catch {
        // Restoring the original branch is best effort.
      }
    }
  }
}

async function applyWorktreeBranch(gitRoot: string, worktree: SessionWorktree): Promise<void> {
  try {
    await git(gitRoot, "diff", "--quiet", `${worktree.baseBranch}...${worktree.branch}`);
    return;
  } catch {
    // A non-zero exit means there are changes to apply.
  }

  const originalBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");
  try {
    await git(gitRoot, "checkout", worktree.baseBranch);
    await git(gitRoot, "merge", "--squash", worktree.branch);
    await git(gitRoot, "reset", "HEAD");
  } catch (error) {
    try {
      await git(gitRoot, "merge", "--abort");
    } catch {
      // No merge may be in progress.
    }
    try {
      await git(gitRoot, "reset", "--merge");
    } catch {
      // Restoring a clean index is best effort.
    }
    throw error;
  } finally {
    if (originalBranch !== worktree.baseBranch) {
      try {
        await git(gitRoot, "checkout", originalBranch);
      } catch {
        // Restoring the original branch is best effort.
      }
    }
  }
}
