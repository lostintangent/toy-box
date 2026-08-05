import { describe, expect, test } from "bun:test";
import { sessionFile } from "@/lib/files/workspaceFile";
import { workerOwnerId, workerParentSessionId, workerReferencesSession } from "./workers";

describe("worker ownership", () => {
  test("derives stable resource identity and optional parent sessions", () => {
    const fileWorker = {
      type: "file",
      sessionId: "worker-a",
      ephemeral: true,
      file: sessionFile("session-a", "notes.md"),
    } as const;
    const appWorker = {
      type: "app",
      sessionId: "worker-b",
      ephemeral: false,
      appId: "app-a",
    } as const;
    expect(workerOwnerId(fileWorker)).toBe("session:session-a:notes.md");
    expect(workerParentSessionId(fileWorker)).toBe("session-a");
    expect(workerParentSessionId(appWorker)).toBeUndefined();
  });

  test("references both a worker session and its direct parent session", () => {
    const worker = {
      type: "app",
      sessionId: "worker-a",
      ephemeral: true,
      appId: "app-a",
    } as const;

    expect(workerReferencesSession(worker, "worker-a")).toBe(true);
    expect(workerReferencesSession(worker, "app-a")).toBe(false);
    expect(
      workerReferencesSession(
        {
          type: "session",
          sessionId: "worker-a",
          ephemeral: false,
          parentSessionId: "session-a",
        },
        "session-a",
      ),
    ).toBe(true);
  });
});
