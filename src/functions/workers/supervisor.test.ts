import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as sdkClientModule from "@/functions/sdk/client";
import * as streamModule from "@/functions/runtime/stream";
import * as sessionRegistryModule from "@/functions/state/session/registry";
import * as snapshotsModule from "@/functions/state/session/snapshots";
import * as workerStateModule from "@/functions/state/session/workers";
import type { SessionSnapshot } from "@/types";

const realSdkClientModule = { ...sdkClientModule };
const realStreamModule = { ...streamModule };
const realSessionRegistryModule = { ...sessionRegistryModule };
const realSnapshotsModule = { ...snapshotsModule };
const realWorkerStateModule = { ...workerStateModule };

type Completion = { status: "completed" | "failed"; response?: string };
type CreateArguments = Parameters<typeof streamModule.createSession>;

const parentModel = { name: "gpt-5", reasoningEffort: "high" as const };
const explicitModel = { name: "claude-sonnet-4.5" };
const parentContext = {
  workingDirectory: "/repo",
  gitRoot: "/repo",
  repository: "example/repo",
};
const parentSnapshot: SessionSnapshot = {
  id: "toy-box-parent",
  messages: [],
  queuedMessages: [],
  model: parentModel,
  status: "idle",
  reasoningContent: "",
};
const fileWorker = {
  type: "file",
  sessionId: "toy-box-worker",
  ephemeral: true,
  file: { type: "session", sessionId: "toy-box-parent", path: "report.md" },
} as const;
const sessionWorker = {
  type: "session",
  sessionId: "toy-box-worker",
  ephemeral: false,
  parentSessionId: "toy-box-parent",
} as const;
const appWorker = {
  type: "app",
  sessionId: "toy-box-worker",
  ephemeral: true,
  appId: "toy-box-app-a",
} as const;

let parentIsLive: boolean;
let workerIsLive: boolean;
let workerCompletion: ReturnType<typeof deferred<Completion>>;

const createSessionMock = mock(async (..._args: CreateArguments) => ({
  disposition: "started" as const,
  waitForCompletion: () => workerCompletion.promise,
}));
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);
const loadSessionSnapshotMock = mock(async () => parentSnapshot);
const readSessionContextMock = mock(async () => parentContext);
const getEphemeralWorkerSessionIdsMock = mock(async (): Promise<string[]> => []);
const abortWorkerMock = mock(async () => {});

mock.module("@/functions/sdk/client", () => ({
  ...realSdkClientModule,
  readSessionContext: readSessionContextMock,
}));
mock.module("@/functions/runtime/stream", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
  SessionStream: {
    get: (sessionId: string) => {
      if (sessionId === "toy-box-parent") {
        return parentIsLive ? { getSessionState: () => ({ model: parentModel }) } : undefined;
      }
      return workerIsLive ? { abort: abortWorkerMock } : undefined;
    },
  },
}));
mock.module("@/functions/state/session/registry", () => ({
  ...realSessionRegistryModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("@/functions/state/session/snapshots", () => ({
  ...realSnapshotsModule,
  loadSessionSnapshot: loadSessionSnapshotMock,
}));
mock.module("@/functions/state/session/workers", () => ({
  ...realWorkerStateModule,
  getEphemeralWorkerSessionIds: getEphemeralWorkerSessionIdsMock,
}));

const { cancelWorker, spawnWorker, sweepAbandonedWorkers, WorkerCanceledError } =
  await import("./supervisor");
const { sharedMap, sharedSet } = await import("@/functions/runtime/processState");

afterAll(() => {
  mock.module("@/functions/sdk/client", () => realSdkClientModule);
  mock.module("@/functions/runtime/stream", () => realStreamModule);
  mock.module("@/functions/state/session/registry", () => realSessionRegistryModule);
  mock.module("@/functions/state/session/snapshots", () => realSnapshotsModule);
  mock.module("@/functions/state/session/workers", () => realWorkerStateModule);
});

beforeEach(() => {
  parentIsLive = true;
  workerIsLive = false;
  workerCompletion = deferred<Completion>();
  createSessionMock.mockClear();
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
  loadSessionSnapshotMock.mockClear();
  readSessionContextMock.mockClear();
  getEphemeralWorkerSessionIdsMock.mockClear();
  getEphemeralWorkerSessionIdsMock.mockImplementation(async () => []);
  abortWorkerMock.mockClear();
  abortWorkerMock.mockImplementation(async () => {
    workerCompletion.resolve({ status: "completed" });
  });
  sharedMap<Promise<void>>("worker-startup-sweeps").clear();
  sharedSet<string>("active-workers").clear();
  sharedSet<string>("canceling-workers").clear();
});

describe("spawnWorker", () => {
  test("inherits its live parent's execution context and deletes after exact completion", async () => {
    const worker = { ...fileWorker, name: "Focused job" };
    const receipt = await spawnWorker({
      worker,
      message: { content: "Do one focused job." },
    });

    expect(receipt.sessionId).toBe("toy-box-worker");
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Do one focused job.", model: parentModel },
      {
        directory: parentContext.workingDirectory,
        initialContext: parentContext,
        worker,
        useWorktree: false,
        name: "Focused job",
      },
    );
    expect(loadSessionSnapshotMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();

    const completion = receipt.waitForCompletion();
    expect(receipt.waitForCompletion()).toBe(completion);
    workerCompletion.resolve({ status: "completed", response: "Done." });

    await expect(completion).resolves.toEqual({ status: "completed", response: "Done." });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("inherits the model from an idle parent snapshot", async () => {
    parentIsLive = false;
    const receipt = await spawnWorker({
      worker: fileWorker,
      message: { content: "Do one focused job." },
    });
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();

    expect(loadSessionSnapshotMock).toHaveBeenCalledWith("toy-box-parent");
    expect(createSessionMock.mock.calls[0]![1]).toMatchObject({ model: parentModel });
    expect(receipt.sessionId).toBe(fileWorker.sessionId);
  });

  test("uses explicit model and directory overrides without reading parent state", async () => {
    parentIsLive = false;
    const receipt = await spawnWorker({
      worker: fileWorker,
      message: { content: "Do one focused job.", model: explicitModel },
      directory: "/other",
    });
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();

    expect(readSessionContextMock).not.toHaveBeenCalled();
    expect(loadSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[0]![1]).toMatchObject({ model: explicitModel });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      directory: "/other",
      initialContext: undefined,
    });
  });

  test("runs app-owned workers without a parent and deletes them after completion", async () => {
    const receipt = await spawnWorker({
      worker: appWorker,
      message: { content: "Generate a pattern.", model: explicitModel },
    });
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();

    expect(readSessionContextMock).not.toHaveBeenCalled();
    expect(loadSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Generate a pattern.", model: explicitModel },
      {
        directory: undefined,
        initialContext: undefined,
        worker: appWorker,
        useWorktree: false,
      },
    );
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("deletes failed workers while preserving their completion result", async () => {
    const receipt = await spawnWorker({
      worker: fileWorker,
      message: { content: "Fail this job." },
    });
    workerCompletion.resolve({ status: "failed", response: "Could not finish." });

    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "failed",
      response: "Could not finish.",
    });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("retains coordinated workers after completion", async () => {
    const receipt = await spawnWorker({
      worker: sessionWorker,
      message: { content: "Investigate in parallel." },
      useWorktree: true,
    });
    workerCompletion.resolve({ status: "completed", response: "Findings." });

    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "completed",
      response: "Findings.",
    });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      worker: sessionWorker,
      useWorktree: true,
    });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("retains an app-owned worker when its lifetime is durable", async () => {
    const worker = { ...appWorker, ephemeral: false };
    const receipt = await spawnWorker({
      worker,
      message: { content: "Remain available for follow-up." },
    });
    workerCompletion.resolve({ status: "completed" });

    await receipt.waitForCompletion();
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({ worker });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("cancels a running worker through its live stream", async () => {
    const receipt = await spawnWorker({
      worker: fileWorker,
      message: { content: "Do one focused job." },
    });
    workerIsLive = true;

    await expect(cancelWorker("toy-box-worker")).resolves.toBe(true);
    expect(abortWorkerMock).toHaveBeenCalledTimes(1);
    await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    await expect(cancelWorker("toy-box-worker")).resolves.toBe(false);
  });

  test("cancels a worker while its inherited context is still loading", async () => {
    const context = deferred<typeof parentContext>();
    readSessionContextMock.mockImplementationOnce(() => context.promise);
    const spawn = spawnWorker({
      worker: fileWorker,
      message: { content: "Do one focused job." },
    });
    await waitFor(() => expect(readSessionContextMock).toHaveBeenCalledTimes(1));

    await expect(cancelWorker("toy-box-worker")).resolves.toBe(true);
    context.resolve(parentContext);

    await expect(spawn).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("cleans up a reserved worker id when session creation fails", async () => {
    const creationError = new Error("Unable to create worker.");
    createSessionMock.mockImplementationOnce(async () => {
      throw creationError;
    });

    await expect(
      spawnWorker({
        worker: fileWorker,
        message: { content: "Do one focused job." },
      }),
    ).rejects.toBe(creationError);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("cleans up a reserved worker id when parent context loading fails", async () => {
    const contextError = new Error("Unable to load parent context.");
    readSessionContextMock.mockImplementationOnce(async () => {
      throw contextError;
    });

    await expect(
      spawnWorker({
        worker: fileWorker,
        message: { content: "Do one focused job." },
      }),
    ).rejects.toBe(contextError);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("sweeps ephemeral workers left by a previous process", async () => {
    getEphemeralWorkerSessionIdsMock.mockImplementationOnce(async () => [
      "toy-box-worker-a",
      "toy-box-worker-b",
    ]);

    await sweepAbandonedWorkers();

    expect(deleteSessionIfExistsMock.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      "toy-box-worker-a",
      "toy-box-worker-b",
    ]);
  });

  test("reports cleanup failures to completion observers", async () => {
    const cleanupError = new Error("Unable to delete worker.");
    deleteSessionIfExistsMock.mockImplementationOnce(async () => {
      throw cleanupError;
    });
    const receipt = await spawnWorker({
      worker: fileWorker,
      message: { content: "Do one focused job." },
    });
    workerCompletion.resolve({ status: "completed" });

    await expect(receipt.waitForCompletion()).rejects.toBe(cleanupError);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (cause) {
      error = cause;
      await Bun.sleep(5);
    }
  }
  throw error;
}
