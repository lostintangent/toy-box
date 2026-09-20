import * as childProcess from "node:child_process";
import type { SessionContext } from "@sessions/model";

export async function resolveSessionContext(directory: string): Promise<SessionContext> {
  const gitRoot = await detectGitRoot(directory);
  if (!gitRoot) return { directory };

  const branch = await git(directory, "symbolic-ref", "--quiet", "--short", "HEAD").catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === 1) return undefined;
      throw error;
    },
  );
  return {
    directory,
    gitRoot,
    repository: await getRepositoryName(directory),
    branch,
  };
}

export function git(directory: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "git",
      ["-C", directory, ...args],
      // Keep diagnostics stable when distinguishing expected missing Git metadata.
      { encoding: "utf-8", env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

export async function detectGitRoot(directory: string): Promise<string | null> {
  try {
    return await git(directory, "rev-parse", "--show-toplevel");
  } catch (error) {
    if (error instanceof Error && error.message.includes("fatal: not a git repository")) {
      return null;
    }
    throw error;
  }
}

async function getRepositoryName(directory: string): Promise<string | undefined> {
  try {
    const url = await git(directory, "remote", "get-url", "origin");
    return url.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  } catch (error) {
    if (error instanceof Error && error.message.includes("error: No such remote 'origin'")) {
      return undefined;
    }
    throw error;
  }
}
