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
import * as sessionRuntimeModule from "@sessions/server/runtime";
import * as supervisorModule from "./supervisor";
import { sessionFile } from "@files/model";

const realSessionRuntimeModule = { ...sessionRuntimeModule };
const realSupervisorModule = { ...supervisorModule };

const abortWorkerMock = mock(async (_sessionId: string) => false);
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);

mock.module("@workers/server/supervisor", () => ({
  ...realSupervisorModule,
  abortWorker: abortWorkerMock,
}));
mock.module("@sessions/server/runtime", () => ({
  ...realSessionRuntimeModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));

const { deleteWorkersForApp, deleteWorkersForSession } = await import("./cleanup");
const { registerWorkerSession } = await import("./database");
const { finishWorker, hasWorker, startWorker } = await import("./registry");

afterAll(() => {
  mock.module("@workers/server/supervisor", () => realSupervisorModule);
  mock.module("@sessions/server/runtime", () => realSessionRuntimeModule);
});

beforeEach(() => {
  abortWorkerMock.mockClear();
  abortWorkerMock.mockImplementation(async () => false);
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
});

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
      startWorker(worker);
      await registerWorkerSession(worker);
      onTestFinished(() => finishWorker(worker.sessionId));
    }

    await deleteWorkersForSession(parent);

    expect(hasWorker(parent)).toBe(true);
    expect(hasWorker(sessionChild)).toBe(false);
    expect(hasWorker(fileChild)).toBe(false);
    expect(abortWorkerMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
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
      startWorker({
        createdAt: new Date(0).toISOString(),
        type: "app",
        sessionId,
        appId,
        ephemeral: true,
      });
      onTestFinished(() => finishWorker(sessionId));
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
    expect(abortWorkerMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      abandoned,
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
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: "failed-cleanup",
      appId: "app-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: "successful-cleanup",
      appId: "app-a",
      ephemeral: true,
    });
    abortWorkerMock.mockImplementation(async (sessionId) => {
      if (sessionId === "failed-cleanup") throw new Error("cancel failed");
      return false;
    });
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await deleteWorkersForApp("app-a");

    expect(abortWorkerMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("failed-cleanup");
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("successful-cleanup");
    expect(log).toHaveBeenCalledWith(
      "Unable to clean up an app worker:",
      expect.objectContaining({ message: "cancel failed" }),
    );
  });
});
