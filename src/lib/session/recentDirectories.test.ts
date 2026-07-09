import { describe, expect, test } from "bun:test";
import type { SessionMetadata } from "@/types";
import { getRecentDirectories } from "./recentDirectories";

function createSession(
  sessionId: string,
  modifiedTime: number,
  cwd?: string,
  context?: { repository?: string; gitRoot?: string },
): SessionMetadata {
  return {
    sessionId,
    startTime: new Date(modifiedTime),
    modifiedTime: new Date(modifiedTime),
    summary: sessionId,
    isRemote: false,
    context: cwd ? { workingDirectory: cwd, ...context } : undefined,
  };
}

describe("recent directories", () => {
  test("orders unique directories by their most recent session", () => {
    const sessions = [
      createSession("older-repo", 1, "/repo", {
        repository: "repo",
        gitRoot: "/repo",
      }),
      createSession("other", 2, "/other", { repository: "other" }),
      createSession("newer-repo", 3, " /repo "),
    ];

    expect(getRecentDirectories(sessions)).toEqual([
      { cwd: "/repo", repository: "repo", gitRoot: "/repo" },
      { cwd: "/other", repository: "other", gitRoot: undefined },
    ]);
    expect(sessions.map((session) => session.sessionId)).toEqual([
      "older-repo",
      "other",
      "newer-repo",
    ]);
  });

  test("ignores missing directories and limits the source history", () => {
    const sessions = [
      createSession("missing", 100),
      createSession("blank", 99, "   "),
      ...Array.from({ length: 51 }, (_, index) =>
        createSession(`session-${index}`, index, `/repo/${index}`),
      ),
    ];

    const directories = getRecentDirectories(sessions);

    expect(directories).toHaveLength(48);
    expect(directories[0]?.cwd).toBe("/repo/50");
    expect(directories.at(-1)?.cwd).toBe("/repo/3");
  });
});
