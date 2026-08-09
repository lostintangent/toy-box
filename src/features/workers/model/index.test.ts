import { describe, expect, test } from "bun:test";
import { machineFile, sessionFile } from "@files/model";
import {
  cancelWorkerInputSchema,
  spawnWorkerInputSchema,
  workerParentSessionId,
  workerReferencesSession,
} from ".";

describe("worker ownership", () => {
  test("derives optional parent sessions", () => {
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

describe("worker ingress", () => {
  test("accepts file and app commands through their canonical schemas", () => {
    expect(
      spawnWorkerInputSchema.parse({
        type: "file",
        file: sessionFile("session-a", "notes.md"),
        name: "  Reviewer  ",
        message: { content: "Review this file" },
      }),
    ).toMatchObject({ type: "file", name: "Reviewer" });
    expect(
      cancelWorkerInputSchema.parse({
        type: "app",
        appId: "app-a",
        workerSessionId: "worker-a",
      }),
    ).toEqual({ type: "app", appId: "app-a", workerSessionId: "worker-a" });
  });

  test("rejects owners that cannot own workers", () => {
    expect(() =>
      spawnWorkerInputSchema.parse({
        type: "file",
        file: machineFile("/repo/notes.md"),
        message: { content: "Review this file" },
      }),
    ).toThrow();
  });
});
