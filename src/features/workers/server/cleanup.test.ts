import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  onTestFinished,
  spyOn,
  test,
} from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import type { SessionCompletion } from "@sessions/model";
import * as sessionRuntimeModule from "@sessions/server/runtime";
import { sessionFile } from "@files/model";
import type { Worker } from "../model";

const realSessionRuntimeModule = { ...sessionRuntimeModule };

const abortSessionMock = mock(async (_sessionId: string) => false);
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);

mock.module("@sessions/server/runtime", () => ({
  ...realSessionRuntimeModule,
  abortSession: abortSessionMock,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));

const { deleteWorkersForApp, deleteWorkersForSession } = await import("./cleanup");
const { registerWorkerSession } = await import("./database");
const { hasWorker, startWorkerRun } = await import("./registry");

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realSessionRuntimeModule);
});

beforeEach(() => {
  abortSessionMock.mockClear();
  abortSessionMock.mockImplementation(async () => false);
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
});

/** Runs a worker until its test finishes, ignoring cancellation like a stalled execution. */
function startRun(worker: Worker): void {
  const execution = Promise.withResolvers<SessionCompletion>();
  void startWorkerRun(worker, () => execution.promise).catch(() => {});
  onTestFinished(() => execution.resolve({ status: "completed" }));
}

describe("worker cleanup", () => {
  test("deletes direct session children without treating its own worker as a child", async () => {
    await openTestDatabase();
    const parent = "parent-worker";
    const sessionChild = "session-child";
    const fileChild = "file-child";
    const workers = [
      {
        createdAt: new Date(0).toISOString(),
        type: "session" as const,
        sessionId: parent,
        parentSessionId: "grandparent",
        ephemeral: false,
      },
      {
        createdAt: new Date(0).toISOString(),
        type: "session" as const,
        sessionId: sessionChild,
        parentSessionId: parent,
        ephemeral: false,
      },
      {
        createdAt: new Date(0).toISOString(),
        type: "file" as const,
        sessionId: fileChild,
        file: sessionFile(parent, "notes.md"),
        ephemeral: true,
      },
    ];
    for (const worker of workers) {
      startRun(worker);
      await registerWorkerSession(worker);
    }

    await deleteWorkersForSession(parent);

    expect(hasWorker(parent)).toBe(true);
    expect(hasWorker(sessionChild)).toBe(false);
    expect(hasWorker(fileChild)).toBe(false);
    expect(abortSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      fileChild,
      sessionChild,
    ]);
    expect(deleteSessionIfExistsMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      fileChild,
      sessionChild,
    ]);
  });

  test("removes live, queued, and abandoned workers", async () => {
    await openTestDatabase();
    const appId = "app-a";
    const active = "active-app-worker";
    const queued = "queued-app-worker";
    const abandoned = "abandoned-app-worker";
    for (const sessionId of [active, queued]) {
      startRun({
        createdAt: new Date(0).toISOString(),
        type: "app",
        sessionId,
        appId,
        ephemeral: true,
      });
    }
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: active,
      appId,
      ephemeral: false,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: abandoned,
      appId,
      ephemeral: true,
    });

    await deleteWorkersForApp(appId);

    expect(hasWorker(active)).toBe(false);
    expect(hasWorker(queued)).toBe(false);
    expect(abortSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      active,
      queued,
    ]);
    expect(deleteSessionIfExistsMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      abandoned,
      active,
      queued,
    ]);
  });

  test("attempts every independent cleanup", async () => {
    await openTestDatabase();
    const failing = {
      createdAt: new Date(0).toISOString(),
      type: "app" as const,
      sessionId: "failed-cleanup",
      appId: "app-a",
      ephemeral: false,
    };
    startRun(failing);
    await registerWorkerSession(failing);
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: "successful-cleanup",
      appId: "app-a",
      ephemeral: true,
    });
    abortSessionMock.mockImplementation(async () => {
      throw new Error("cancel failed");
    });
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await deleteWorkersForApp("app-a");

    expect(abortSessionMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("failed-cleanup");
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("successful-cleanup");
    expect(log).toHaveBeenCalledWith(
      "Unable to clean up an app worker:",
      expect.objectContaining({ message: "cancel failed" }),
    );
  });
});
