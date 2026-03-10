// Git worktree operations for worktree-backed sessions.
//
// Creates isolated worktrees so each session gets its own branch and
// working copy. Provides merge-back and cleanup operations.

import { execFile as execFileCb } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export type WorktreeInfo = {
  path: string;
  branch: string;
  baseBranch: string;
};

export type MergeResult = { status: "merged" } | { status: "conflicts" } | { status: "no-changes" };
export type ApplyResult =
  | { status: "applied" }
  | { status: "conflicts" }
  | { status: "no-changes" };

/** Run a git command in the given directory and return trimmed stdout. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args], { encoding: "utf-8" });
  return stdout.trim();
}

/** Get the repository name (owner/repo) from a directory's git remote URL. */
export async function getRepositoryName(directory: string): Promise<string | undefined> {
  try {
    const url = await git(directory, "remote", "get-url", "origin");
    const match = url.match(/[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Detect the git root for a directory. Returns null if not inside a repo. */
export async function detectGitRoot(directory: string): Promise<string | null> {
  try {
    return await git(directory, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
}

/** Create a new worktree + branch for a session. */
export async function createWorktree(gitRoot: string, sessionId: string): Promise<WorktreeInfo> {
  const shortId = sessionId.replace(/^toy-box-/, "").slice(0, 12);
  const branch = `toy-box/${shortId}`;
  const path = join(homedir(), ".toy-box", "worktrees", shortId);
  const baseBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");

  await git(gitRoot, "worktree", "add", "-b", branch, path, "HEAD");

  return { path, branch, baseBranch };
}

/** Remove a worktree and delete its branch. Failures are logged, not thrown. */
export async function removeWorktree(
  gitRoot: string,
  info: { path: string; branch: string },
): Promise<void> {
  try {
    await git(gitRoot, "worktree", "remove", "--force", info.path);
  } catch (error) {
    console.error(`Failed to remove worktree at ${info.path}:`, error);
  }

  try {
    await git(gitRoot, "branch", "-D", info.branch);
  } catch (error) {
    console.error(`Failed to delete branch ${info.branch}:`, error);
  }
}

/** Clean up a worktree by detecting the main repository root, removing the worktree, and deleting the branch. */
export async function cleanupWorktree(info: { path: string; branch: string }): Promise<void> {
  // Use --git-common-dir to resolve to the main repo, not the worktree itself.
  // This ensures branch deletion still works after the worktree directory is removed.
  const mainRepoGitDir = await detectMainGitDir(info.path);
  if (!mainRepoGitDir) return;
  await removeWorktree(mainRepoGitDir, info);
}

/** Detect the main repository's working directory for a path (resolves through worktrees). */
async function detectMainGitDir(directory: string): Promise<string | null> {
  try {
    // --path-format=absolute ensures we get an absolute path even at the repo root
    const commonDir = await git(
      directory,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    // Returns a path like "/repo/.git" — the working directory is the parent
    return dirname(commonDir);
  } catch {
    return null;
  }
}

/** Merge a worktree branch back into its base branch. */
export async function mergeWorktreeBranch(
  gitRoot: string,
  info: { branch: string; baseBranch: string },
): Promise<MergeResult> {
  // Check if there are any changes to merge
  try {
    await git(gitRoot, "diff", "--quiet", `${info.baseBranch}...${info.branch}`);
    return { status: "no-changes" };
  } catch {
    // Non-zero exit means there are differences — continue to merge
  }

  // Switch to base branch and attempt the merge
  const originalBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");
  try {
    await git(gitRoot, "checkout", info.baseBranch);
    await git(gitRoot, "merge", "--no-ff", info.branch, "-m", `Merge session ${info.branch}`);
    return { status: "merged" };
  } catch {
    // Merge failed — abort and restore
    try {
      await git(gitRoot, "merge", "--abort");
    } catch {
      // Ignore if abort fails (no merge in progress)
    }
    return { status: "conflicts" };
  } finally {
    // Restore original branch if we switched away
    if (originalBranch !== info.baseBranch) {
      try {
        await git(gitRoot, "checkout", originalBranch);
      } catch {
        // Best effort — don't throw from finally
      }
    }
  }
}

/** Apply a worktree branch's changes to the base branch as uncommitted modifications. */
export async function applyWorktreeBranch(
  gitRoot: string,
  info: { branch: string; baseBranch: string },
): Promise<ApplyResult> {
  // Check if there are any changes to apply
  try {
    await git(gitRoot, "diff", "--quiet", `${info.baseBranch}...${info.branch}`);
    return { status: "no-changes" };
  } catch {
    // Non-zero exit means there are differences — continue
  }

  // Switch to base branch, squash-merge to stage all changes, then
  // reset the index so the changes appear as uncommitted modifications.
  const originalBranch = await git(gitRoot, "rev-parse", "--abbrev-ref", "HEAD");
  try {
    await git(gitRoot, "checkout", info.baseBranch);
    await git(gitRoot, "merge", "--squash", info.branch);
    await git(gitRoot, "reset", "HEAD");
    return { status: "applied" };
  } catch {
    // Squash merge failed — abort and restore clean state
    try {
      await git(gitRoot, "merge", "--abort");
    } catch {
      // Ignore if no merge in progress
    }
    try {
      await git(gitRoot, "reset", "--merge");
    } catch {
      // Best effort
    }
    return { status: "conflicts" };
  } finally {
    // Restore original branch if we switched away
    if (originalBranch !== info.baseBranch) {
      try {
        await git(gitRoot, "checkout", originalBranch);
      } catch {
        // Best effort — don't throw from finally
      }
    }
  }
}
