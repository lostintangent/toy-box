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
const deleteSessionMock = mock(async (_sessionId: string) => {});

mock.module("@sessions/server/runtime", () => ({
  ...realSessionRuntimeModule,
  abortSession: abortSessionMock,
  deleteSession: deleteSessionMock,
}));

const { deleteWorkersForApp, deleteWorkersForSession } = await import("./cleanup");
const { WorkerDatabase } = await import("./database");
const { getActiveWorker, startWorkerRun } = await import("./registry");

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realSessionRuntimeModule);
});

beforeEach(() => {
  abortSessionMock.mockClear();
  abortSessionMock.mockImplementation(async () => false);
  deleteSessionMock.mockClear();
  deleteSessionMock.mockImplementation(async () => {});
});

/** Runs a worker until its test finishes, ignoring cancellation like a stalled execution. */
function startRun(worker: Worker): void {
  const execution = Promise.withResolvers<SessionCompletion>();
  void startWorkerRun(worker, () => execution.promise).catch(() => {});
  onTestFinished(() => execution.resolve({ status: "completed" }));
}

describe("worker cleanup", () => {
  test("deletes direct session children without treating its own worker as a child", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
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
      await store.create(worker);
    }

    await deleteWorkersForSession(parent);

    expect(getActiveWorker(parent)).toBeDefined();
    expect(getActiveWorker(sessionChild)).toBeUndefined();
    expect(getActiveWorker(fileChild)).toBeUndefined();
    expect(abortSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      fileChild,
      sessionChild,
    ]);
    expect(deleteSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      fileChild,
      sessionChild,
    ]);
  });

  test("removes live, queued, and abandoned workers", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
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
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: active,
      appId,
      ephemeral: false,
    });
    await store.create({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: abandoned,
      appId,
      ephemeral: true,
    });

    await deleteWorkersForApp(appId);

    expect(getActiveWorker(active)).toBeUndefined();
    expect(getActiveWorker(queued)).toBeUndefined();
    expect(abortSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      active,
      queued,
    ]);
    expect(deleteSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      abandoned,
      active,
      queued,
    ]);
  });

  test("attempts every independent cleanup", async () => {
    const store = new WorkerDatabase(await openTestDatabase());
    const failing = {
      createdAt: new Date(0).toISOString(),
      type: "app" as const,
      sessionId: "failed-cleanup",
      appId: "app-a",
      ephemeral: false,
    };
    startRun(failing);
    await store.create(failing);
    await store.create({
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
    expect(deleteSessionMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionMock).toHaveBeenCalledWith("failed-cleanup");
    expect(deleteSessionMock).toHaveBeenCalledWith("successful-cleanup");
    expect(log).toHaveBeenCalledWith(
      "Unable to clean up an app worker:",
      expect.objectContaining({ message: "cancel failed" }),
    );
  });
});
