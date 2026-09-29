import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as streamModule from "@sessions/server/runtime";
import * as workerStateModule from "./database";
import type { SessionCompletion, SessionState } from "@sessions/model";
import { createInitialSessionState } from "@sessions/model/reducer";
import type { Worker } from "../model";

const realStreamModule = { ...streamModule };
const realWorkerStateModule = { ...workerStateModule };

type Completion = SessionCompletion;
type CreateArguments = Parameters<typeof streamModule.createSession>;

const parentModel = { provider: "copilot", name: "gpt-5", reasoningEffort: "high" as const };
const explicitModel = { provider: "copilot", name: "claude-sonnet-4.5" };
const parentDirectory = "/repo/.worktrees/parent";
const parentSnapshot: SessionState = createInitialSessionState({
  model: parentModel,
});
const fileWorker = {
  createdAt: new Date(0).toISOString(),
  type: "file",
  sessionId: "toy-box-worker",
  ephemeral: true,
  file: { kind: "session", sessionId: "toy-box-parent", path: "report.md" },
} as const;
const sessionWorker = {
  createdAt: new Date(0).toISOString(),
  type: "session",
  sessionId: "toy-box-worker",
  ephemeral: false,
  parentSessionId: "toy-box-parent",
} as const;
const appWorker = {
  createdAt: new Date(0).toISOString(),
  type: "app",
  sessionId: "toy-box-worker",
  ephemeral: true,
  appId: "toy-box-app-a",
} as const;

let workerIsLive: boolean;
let storedWorker: Worker | null;
let workerCompletion: ReturnType<typeof Promise.withResolvers<Completion>>;
const admissionCalls: string[] = [];

const createSessionMock = mock(async (..._args: CreateArguments) => {
  admissionCalls.push("create");
  return {
    disposition: "started" as const,
    waitForCompletion: () => workerCompletion.promise,
  };
});
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);
const getSessionSnapshotMock = mock(async () => parentSnapshot);
const getSessionDirectoryMock = mock(async () => parentDirectory);
const getEphemeralWorkerSessionIdsMock = mock(async (): Promise<string[]> => []);
const getPersistedWorkerMock = mock(async () => storedWorker);
const registerWorkerSessionMock = mock(async (worker: Worker) => {
  storedWorker = worker;
  admissionCalls.push("register");
});
const abortSessionMock = mock(async () => false);

mock.module("@sessions/server/runtime", () => ({
  ...realStreamModule,
  abortSession: abortSessionMock,
  createSession: createSessionMock,
  deleteSessionIfExists: deleteSessionIfExistsMock,
  getSessionSnapshot: getSessionSnapshotMock,
  getSessionDirectory: getSessionDirectoryMock,
}));
mock.module("@workers/server/database", () => ({
  ...realWorkerStateModule,
  getEphemeralWorkerSessionIds: getEphemeralWorkerSessionIdsMock,
  getPersistedWorker: getPersistedWorkerMock,
  registerWorkerSession: registerWorkerSessionMock,
}));

const { cancelWorker, superviseWorker, sweepAbandonedWorkers, WorkerCanceledError } =
  await import("./supervisor");
const { sharedMap, sharedSet } = await import("@/shared/server/processState");

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realStreamModule);
  mock.module("@workers/server/database", () => realWorkerStateModule);
});

beforeEach(() => {
  workerIsLive = false;
  storedWorker = null;
  workerCompletion = Promise.withResolvers<Completion>();
  admissionCalls.length = 0;
  createSessionMock.mockClear();
  createSessionMock.mockImplementation(async () => {
    admissionCalls.push("create");
    return {
      disposition: "started",
      waitForCompletion: () => workerCompletion.promise,
    };
  });
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => {
    storedWorker = null;
    return true;
  });
  getSessionSnapshotMock.mockClear();
  getSessionDirectoryMock.mockClear();
  getEphemeralWorkerSessionIdsMock.mockClear();
  getEphemeralWorkerSessionIdsMock.mockImplementation(async () => []);
  getPersistedWorkerMock.mockClear();
  getPersistedWorkerMock.mockImplementation(async () => storedWorker);
  registerWorkerSessionMock.mockClear();
  registerWorkerSessionMock.mockImplementation(async (worker) => {
    storedWorker = worker;
    admissionCalls.push("register");
  });
  abortSessionMock.mockClear();
  abortSessionMock.mockImplementation(async () => {
    if (!workerIsLive) return false;
    workerCompletion.resolve({ status: "completed" });
    return true;
  });
  sharedMap<Promise<void>>("worker-startup-sweeps").clear();
  sharedSet<string>("active-workers").clear();
  sharedSet<string>("canceling-workers").clear();
});

describe("superviseWorker", () => {
  test("inherits its parent's model and worktree directory and deletes after exact completion", async () => {
    const worker = { ...fileWorker, name: "Focused job" };
    const receipt = await superviseWorker({
      worker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });

    expect(receipt.sessionId).toBe("toy-box-worker");
    expect(registerWorkerSessionMock).toHaveBeenCalledWith(worker);
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Do one focused job.", model: parentModel },
      {
        directory: parentDirectory,
        sessionType: "worker",
        parentSessionId: "toy-box-parent",
        useWorktree: false,
        name: "Focused job",
      },
    );
    expect(admissionCalls.slice(0, 2)).toEqual(["register", "create"]);
    expect(getSessionSnapshotMock).toHaveBeenCalledWith("toy-box-parent");
    expect(getSessionDirectoryMock).toHaveBeenCalledWith("toy-box-parent");
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();

    const completion = receipt.waitForCompletion();
    expect(receipt.waitForCompletion()).toBe(completion);
    workerCompletion.resolve({ status: "completed", response: "Done." });

    await expect(completion).resolves.toEqual({ status: "completed", response: "Done." });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("admits without waiting for startup and executes without a completion observer", async () => {
    const starting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    createSessionMock.mockImplementationOnce(async () => {
      starting.resolve();
      await release.promise;
      return { disposition: "started", waitForCompletion: () => workerCompletion.promise };
    });
    const receipt = await superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Start work." },
      admit: async () => {
        await registerWorkerSessionMock(sessionWorker);
        return { title: "Committed work" };
      },
    });
    expect(receipt.value).toEqual({ title: "Committed work" });
    expect(registerWorkerSessionMock).toHaveBeenCalledWith(sessionWorker);
    await starting.promise;
    release.resolve();
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();
  });

  test("rejects admission and cleans up when persistence fails", async () => {
    const error = new Error("Registration failed");
    registerWorkerSessionMock.mockRejectedValueOnce(error);

    await expect(
      superviseWorker({
        worker: sessionWorker,
        retention: "durable",
        message: { content: "Start work." },
      }),
    ).rejects.toBe(error);

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionWorker.sessionId);
  });

  test("cancels during persistence without admitting or starting the Worker", async () => {
    const persisting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    registerWorkerSessionMock.mockImplementationOnce(async () => {
      persisting.resolve();
      await release.promise;
    });
    const spawning = superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Start work." },
    });
    await persisting.promise;
    await cancelWorker(sessionWorker.sessionId);
    release.resolve();

    await expect(spawning).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionWorker.sessionId);
  });

  test("honors cancellation while inheritance is pending", async () => {
    const directory = Promise.withResolvers<string>();
    getSessionDirectoryMock.mockImplementationOnce(() => directory.promise);
    const spawning = superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Start work." },
    });
    await waitFor(() => expect(getSessionDirectoryMock).toHaveBeenCalledTimes(1));
    await expect(cancelWorker(sessionWorker.sessionId)).resolves.toBe(true);
    directory.resolve(parentDirectory);
    await expect(spawning).rejects.toBeInstanceOf(WorkerCanceledError);

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionWorker.sessionId);
  });

  test("uses explicit model and directory overrides without reading parent state", async () => {
    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job.", model: explicitModel },
      location: { directory: "/other" },
    });
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();

    expect(getSessionDirectoryMock).not.toHaveBeenCalled();
    expect(getSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[0]![1]).toMatchObject({ model: explicitModel });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      directory: "/other",
    });
  });

  test("runs app-owned workers without a parent and deletes them after completion", async () => {
    const receipt = await superviseWorker({
      worker: appWorker,
      retention: "ephemeral",
      message: { content: "Generate a pattern.", model: explicitModel },
    });
    workerCompletion.resolve({ status: "completed" });
    await receipt.waitForCompletion();

    expect(getSessionDirectoryMock).not.toHaveBeenCalled();
    expect(getSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Generate a pattern.", model: explicitModel },
      {
        directory: undefined,
        sessionType: "worker",
        parentSessionId: undefined,
        useWorktree: false,
      },
    );
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("deletes failed workers while preserving their completion result", async () => {
    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
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
    const receipt = await superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Investigate in parallel." },
      location: { useWorktree: true },
    });
    workerCompletion.resolve({ status: "completed", response: "Findings." });

    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "completed",
      response: "Findings.",
    });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      sessionType: "worker",
      parentSessionId: "toy-box-parent",
      useWorktree: true,
    });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("retains an app-owned worker when it is not ephemeral", async () => {
    const worker = { ...appWorker, ephemeral: false };
    const receipt = await superviseWorker({
      worker,
      retention: "durable",
      message: { content: "Remain available for follow-up." },
    });
    workerCompletion.resolve({ status: "completed" });

    await receipt.waitForCompletion();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("cancels a running worker through its live stream", async () => {
    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    workerIsLive = true;

    await expect(cancelWorker("toy-box-worker")).resolves.toBe(true);
    expect(abortSessionMock).toHaveBeenCalledWith("toy-box-worker");
    await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    await expect(cancelWorker("toy-box-worker")).resolves.toBe(false);
  });

  test("cleans up a reserved worker id when session creation fails", async () => {
    const creationError = new Error("Unable to create worker.");
    createSessionMock.mockImplementationOnce(async () => {
      throw creationError;
    });

    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "failed",
      error: creationError.message,
    });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test.each([
    sessionWorker,
    { ...appWorker, ephemeral: false },
    {
      type: "inbox",
      sessionId: "toy-box-worker",
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
    },
  ] as const)("retains admitted $type ownership when provider startup fails", async (worker) => {
    const error = new Error("Provider unavailable");
    createSessionMock.mockRejectedValueOnce(error);
    const receipt = await superviseWorker({
      worker,
      retention: "durable",
      message: { content: "Keep my submission." },
    });
    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "failed",
      error: error.message,
    });
    expect(registerWorkerSessionMock).toHaveBeenCalledWith(worker);
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("retains an admitted durable Worker when inheritance fails", async () => {
    const error = new Error("Parent unavailable");
    getSessionSnapshotMock.mockRejectedValueOnce(error);
    const receipt = await superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Keep this." },
      admit: async () => {
        await registerWorkerSessionMock(sessionWorker);
        return false;
      },
    });
    expect(receipt.value).toBe(false);
    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "failed",
      error: error.message,
    });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("normalizes a startup rejection caused by cancellation", async () => {
    const starting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    createSessionMock.mockImplementationOnce(async () => {
      starting.resolve();
      await release.promise;
      throw new Error("Provider connection closed");
    });
    const receipt = await superviseWorker({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Cancel me." },
    });
    await starting.promise;
    await cancelWorker(sessionWorker.sessionId);
    release.resolve();
    await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionWorker.sessionId);
  });

  test("cancels an Inbox Worker during Session startup and cleans up the late creation", async () => {
    const starting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    createSessionMock.mockImplementationOnce(async () => {
      starting.resolve();
      await release.promise;
      return {
        disposition: "started",
        waitForCompletion: () => workerCompletion.promise,
      };
    });
    const receipt = await superviseWorker({
      worker: {
        type: "inbox",
        sessionId: "toy-box-worker",
        createdAt: new Date(0).toISOString(),
        ephemeral: false,
      },
      retention: "durable",
      message: { content: "Start background work." },
    });
    await starting.promise;
    await expect(cancelWorker("toy-box-worker")).resolves.toBe(true);
    release.resolve();
    await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
    expect(await cancelWorker("toy-box-worker")).toBe(false);
  });

  test("cleans up a reserved worker id when parent directory loading fails", async () => {
    const directoryError = new Error("Unable to load parent directory.");
    getSessionDirectoryMock.mockImplementationOnce(async () => {
      throw directoryError;
    });

    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await expect(receipt.waitForCompletion()).resolves.toEqual({
      status: "failed",
      error: directoryError.message,
    });
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

  test("reports cleanup failures to completion waiters", async () => {
    const cleanupError = new Error("Unable to delete worker.");
    deleteSessionIfExistsMock.mockImplementationOnce(async () => {
      throw cleanupError;
    });
    const receipt = await superviseWorker({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    workerCompletion.resolve({ status: "completed" });

    await expect(receipt.waitForCompletion()).rejects.toBe(cleanupError);
  });

  test.each([true, false])(
    "completion awaits a retention decision over the latest metadata (retain=%s)",
    async (retain) => {
      const deciding = Promise.withResolvers<void>();
      const decision = Promise.withResolvers<boolean>();
      const cleaning = Promise.withResolvers<void>();
      const cleanup = Promise.withResolvers<void>();
      const initial = { ...sessionWorker, metadata: { result: "Initial" } };
      const latest = { ...initial, metadata: { result: "Published" } };
      const result: SessionCompletion = { status: "completed", response: "Done" };
      const receipt = await superviseWorker({
        worker: initial,
        message: { content: "Publish a result" },
        retention: async (worker, completion) => {
          expect(worker).toEqual(latest);
          expect(completion).toEqual(result);
          deciding.resolve();
          return decision.promise;
        },
      });
      if (!retain) {
        deleteSessionIfExistsMock.mockImplementationOnce(async () => {
          cleaning.resolve();
          await cleanup.promise;
          storedWorker = null;
          return true;
        });
      }
      storedWorker = latest;
      let completed = false;
      const waiting = receipt.waitForCompletion().then((completion) => {
        completed = true;
        return completion;
      });
      workerCompletion.resolve(result);
      await deciding.promise;
      expect(completed).toBe(false);
      expect(storedWorker).toEqual(latest);
      decision.resolve(retain);
      if (!retain) {
        await cleaning.promise;
        expect(completed).toBe(false);
        cleanup.resolve();
      }
      await expect(waiting).resolves.toEqual(result);
      if (retain) expect(storedWorker).toEqual(latest);
      else expect(storedWorker).toBeNull();
    },
  );

  test.each(["startup", "execution"])(
    "retention receives %s exceptions as failed completion data",
    async (phase) => {
      const failure = new Error("Provider unavailable");
      if (phase === "startup") createSessionMock.mockRejectedValueOnce(failure);
      else
        createSessionMock.mockResolvedValueOnce({
          disposition: "started",
          waitForCompletion: () => Promise.reject(failure),
        });
      const retention = mock(() => true);
      const receipt = await superviseWorker({
        worker: sessionWorker,
        message: { content: "Keep my submission" },
        retention,
      });
      const result = { status: "failed", error: failure.message } satisfies SessionCompletion;
      await expect(receipt.waitForCompletion()).resolves.toEqual(result);
      expect(retention).toHaveBeenCalledWith(sessionWorker, result);
      expect(storedWorker).toEqual(sessionWorker);
    },
  );

  test("a retention exception preserves ownership and rejects completion", async () => {
    const error = new Error("Retention unavailable");
    const receipt = await superviseWorker({
      worker: sessionWorker,
      message: { content: "Keep my result if the decision fails" },
      retention: () => {
        throw error;
      },
    });
    workerCompletion.resolve({ status: "completed" });
    await expect(receipt.waitForCompletion()).rejects.toBe(error);
    expect(storedWorker).toEqual(sessionWorker);
  });

  test.each(["canceled", "deleted"])("retention is skipped for %s work", async (action) => {
    const retention = mock(() => false);
    const receipt = await superviseWorker({
      worker: sessionWorker,
      message: { content: "Stop this work" },
      retention,
    });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalled());
    if (action === "canceled") await cancelWorker(sessionWorker.sessionId);
    else storedWorker = null;
    workerCompletion.resolve({ status: "completed" });
    if (action === "canceled")
      await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    else await expect(receipt.waitForCompletion()).resolves.toEqual({ status: "completed" });
    expect(retention).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("cancellation during retention takes precedence over automatic deletion", async () => {
    const deciding = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<boolean>();
    const receipt = await superviseWorker({
      worker: sessionWorker,
      message: { content: "Stop while deciding" },
      retention: () => {
        deciding.resolve();
        return decision.promise;
      },
    });
    workerCompletion.resolve({ status: "completed" });
    await deciding.promise;
    await cancelWorker(sessionWorker.sessionId);
    decision.resolve(false);
    await expect(receipt.waitForCompletion()).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(storedWorker).toEqual(sessionWorker);
  });
});

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
