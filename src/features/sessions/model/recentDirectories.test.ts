import { describe, expect, test } from "bun:test";
import type { Session } from "./index";
import { getRecentDirectories } from "./recentDirectories";

function createSession(sessionId: string, updatedAt: number, directory?: string): Session {
  return {
    id: sessionId,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    title: sessionId,
    context: { directory },
  };
}

describe("recent directories", () => {
  test("orders unique directories by their most recent session", () => {
    const sessions = [
      {
        ...createSession("older-repo", 1, "/repo"),
        context: { directory: "/repo", repository: "owner/repo", gitRoot: "/repo" },
      },
      createSession("other", 2, "/other"),
      createSession("newer-repo", 3, " /repo "),
    ];

    expect(getRecentDirectories(sessions)).toEqual([
      { cwd: "/repo", repository: "owner/repo", gitRoot: "/repo" },
      { cwd: "/other", repository: undefined, gitRoot: undefined },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(["older-repo", "other", "newer-repo"]);
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

  test("does not mix older repository metadata into a newer Git snapshot", () => {
    const directories = getRecentDirectories([
      {
        ...createSession("newer", 2, "/repo"),
        context: { directory: "/repo", gitRoot: "/repo" },
      },
      {
        ...createSession("older", 1, "/repo"),
        context: { directory: "/repo", gitRoot: "/repo", repository: "old/remote" },
      },
    ]);

    expect(directories).toEqual([{ cwd: "/repo", gitRoot: "/repo", repository: undefined }]);
  });
});
