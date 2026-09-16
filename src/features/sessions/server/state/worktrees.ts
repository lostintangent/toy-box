// Session worktree state.
//
// A worktree is a session-owned resource whose Git checkout and database
// record must move together. This module owns that complete lifecycle so
// session callers never coordinate Git and persistence independently.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getStateDatabase } from "@/server/database";
import type { SessionWorktree } from "@sessions/model";
import { detectGitRoot, git } from "../git";

/** Create and persist a worktree for a session when its directory is a Git repository. */
export async function createSessionWorktree(
  sessionId: string,
  directory: string,
): Promise<SessionWorktree | undefined> {
  const gitRoot = await detectGitRoot(directory);
  if (!gitRoot) return undefined;

  const worktree = await createGitWorktree(gitRoot, sessionId);

  try {
    await saveSessionWorktree(sessionId, worktree);
  } catch (error) {
    await cleanupGitWorktree(worktree).catch(console.error);
    throw error;
  }

  return worktree;
}

/** Get every session worktree for session-list hydration. */
export async function getAllSessionWorktrees(): Promise<Record<string, SessionWorktree>> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return {};

  const rows = await db<SessionWorktreeRow[]>`SELECT * FROM worktrees`;
  const worktrees: Record<string, SessionWorktree> = {};
  for (const row of rows) {
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

  if (await git(worktree.path, "status", "--porcelain")) {
    throw new Error("Commit the session's changes before applying or merging its worktree.");
  }

  const gitRoot = await detectMainGitRoot(worktree.path);
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
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return null;

  const [row] = await db<SessionWorktreeRow[]>`
    SELECT * FROM worktrees WHERE session_id = ${sessionId}
  `;
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
  const db = await getStateDatabase();
  await db`
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
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return;
  await db`DELETE FROM worktrees WHERE session_id = ${sessionId}`;
}

// Git mechanics

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
