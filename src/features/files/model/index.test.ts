import { describe, expect, test } from "bun:test";
import {
  decodeFileRoute,
  encodeFileRoute,
  ownerSessionId,
  sessionFileFromPath,
  workspaceFileId,
  type WorkspaceFile,
} from ".";

const sessionFile: WorkspaceFile = {
  kind: "session",
  sessionId: "toy-box-session",
  path: "plan.md",
};
const machineFile: WorkspaceFile = { kind: "machine", path: "/repo/src/foo.ts" };

describe("workspace files", () => {
  test("identity distinguishes session and machine files", () => {
    expect(workspaceFileId(sessionFile)).toBe("session:toy-box-session:plan.md");
    expect(workspaceFileId(machineFile)).toBe("machine:/repo/src/foo.ts");
  });

  test("owner is the session for session files and absent for machine files", () => {
    expect(ownerSessionId(sessionFile)).toBe("toy-box-session");
    expect(ownerSessionId(machineFile)).toBeUndefined();
  });

  test("route encoding round-trips both scopes", () => {
    for (const file of [sessionFile, machineFile]) {
      const { scope, path } = encodeFileRoute(file);
      expect(decodeFileRoute(scope, path)).toEqual(file);
    }
  });

  test.each([
    ["/home/me/.toy-box/sessions/s1/artifacts/a/b.svg", { sessionId: "s1", path: "a/b.svg" }],
    ["/Users/me/.toy-box/sessions/s1/attachments/input.txt", undefined],
    ["/Users/me/.toy-box/sessions/s1/artifacts/", undefined],
    ["/repo/src/foo.ts", undefined],
  ])("the session file at %s", (path, expected) => {
    expect(sessionFileFromPath(path)).toEqual(expected && { kind: "session", ...expected });
  });

  test("session URLs stay bare while machine files use the machine scope", () => {
    expect(encodeFileRoute(sessionFile)).toEqual({ scope: "toy-box-session", path: "plan.md" });
    expect(encodeFileRoute(machineFile)).toEqual({ scope: "machine", path: "repo/src/foo.ts" });
  });
});
