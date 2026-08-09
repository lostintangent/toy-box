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
import * as databaseModule from "@/server/database";
import * as sessionRuntimeModule from "@sessions/server/runtime";
import * as supervisorModule from "./supervisor";

const realDatabaseModule = { ...databaseModule };
const realSessionRuntimeModule = { ...sessionRuntimeModule };
const realSupervisorModule = { ...supervisorModule };

let currentDb: Bun.SQL | undefined;
const cancelWorkerMock = mock(async (_sessionId: string) => false);
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);

mock.module("@/server/database", () => ({
  ...realDatabaseModule,
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened.");
    return currentDb;
  },
}));
mock.module("@workers/server/supervisor", () => ({
  ...realSupervisorModule,
  cancelWorker: cancelWorkerMock,
}));
mock.module("@sessions/server/runtime", () => ({
  ...realSessionRuntimeModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));

const { deleteWorkersForApp } = await import("./cleanup");
const { registerWorkerSession } = await import("./database");
const { finishWorker, hasWorker, startWorker } = await import("./registry");

afterAll(() => {
  mock.module("@/server/database", () => realDatabaseModule);
  mock.module("@workers/server/supervisor", () => realSupervisorModule);
  mock.module("@sessions/server/runtime", () => realSessionRuntimeModule);
});

beforeEach(() => {
  currentDb = undefined;
  cancelWorkerMock.mockClear();
  cancelWorkerMock.mockImplementation(async () => false);
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
});

describe("app worker cleanup", () => {
  test("removes live, queued, and abandoned workers", async () => {
    await openDatabase();
    const appId = "app-a";
    const active = "active-app-worker";
    const queued = "queued-app-worker";
    const abandoned = "abandoned-app-worker";
    for (const sessionId of [active, queued]) {
      startWorker({ type: "app", sessionId, appId, ephemeral: true });
      onTestFinished(() => finishWorker(sessionId));
    }
    await registerWorkerSession({
      type: "app",
      sessionId: active,
      appId,
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "app",
      sessionId: abandoned,
      appId,
      ephemeral: true,
    });

    await deleteWorkersForApp(appId);

    expect(hasWorker(active)).toBe(false);
    expect(hasWorker(queued)).toBe(false);
    expect(cancelWorkerMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
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
    await openDatabase();
    await registerWorkerSession({
      type: "app",
      sessionId: "failed-cleanup",
      appId: "app-a",
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "app",
      sessionId: "successful-cleanup",
      appId: "app-a",
      ephemeral: true,
    });
    cancelWorkerMock.mockImplementation(async (sessionId) => {
      if (sessionId === "failed-cleanup") throw new Error("cancel failed");
      return false;
    });
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await deleteWorkersForApp("app-a");

    expect(cancelWorkerMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("successful-cleanup");
    expect(log).toHaveBeenCalledWith(
      "Unable to clean up an app worker:",
      expect.objectContaining({ message: "cancel failed" }),
    );
  });
});

async function openDatabase(): Promise<void> {
  currentDb = await databaseModule.createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}
