import { afterAll, beforeEach, describe, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import * as streamModule from "@sessions/server/runtime";
import { openTestDatabase } from "@/server/testFixtures";
import { WorkerDatabase } from "./database";
import type { SessionCompletion, SessionState } from "@sessions/model";
import { createInitialSessionState } from "@sessions/model/reducer";
import type { Worker } from "../model";
import type { WorkerSpawn } from "./supervisor";

const realStreamModule = { ...streamModule };

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
let workers: WorkerDatabase;
let workerCompletion: ReturnType<typeof Promise.withResolvers<Completion>>;

const createSessionMock = mock(async (..._args: CreateArguments) => {
  return {
    disposition: "started" as const,
    waitForCompletion: () => workerCompletion.promise,
  };
});
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);
const getSessionSnapshotMock = mock(async () => parentSnapshot);
const getSessionDirectoryMock = mock(async () => parentDirectory);
const abortSessionMock = mock(async () => false);

mock.module("@sessions/server/runtime", () => ({
  ...realStreamModule,
  abortSession: abortSessionMock,
  createSession: createSessionMock,
  deleteSessionIfExists: deleteSessionIfExistsMock,
  getSessionSnapshot: getSessionSnapshotMock,
  getSessionDirectory: getSessionDirectoryMock,
}));

const { spawnWorker, sweepAbandonedWorkers } = await import("./supervisor");
const { cancelWorker, WorkerCanceledError } = await import("./registry");
const { getProcessValue } = await import("@/shared/server/processState");
const log = spyOn(console, "error").mockImplementation(() => {});

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realStreamModule);
  log.mockRestore();
  setSystemTime();
});

/** Spawns a fixture's Worker. Each fixture's `ephemeral` flag matches the retention it's given. */
function spawn({ worker, ...input }: Omit<WorkerSpawn, "owner"> & { worker: Worker }) {
  const { createdAt: _, ephemeral: __, sessionId, name, metadata, ...owner } = worker;
  return spawnWorker({ ...input, owner, sessionId, name, metadata });
}

/** The admitted Worker's durable record. */
function storedWorker() {
  return workers.get("toy-box-worker");
}

/** Waits by ID, as the worker's callers do. */
async function workerResult(): Promise<Completion> {
  const [result] = await streamModule.waitForSessions(["toy-box-worker"]);
  return result!;
}

beforeEach(async () => {
  setSystemTime(new Date(0));
  workerIsLive = false;
  workers = new WorkerDatabase(await openTestDatabase());
  workerCompletion = Promise.withResolvers<Completion>();
  createSessionMock.mockClear();
  createSessionMock.mockImplementation(async () => ({
    disposition: "started",
    waitForCompletion: () => workerCompletion.promise,
  }));
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async (sessionId) => {
    await workers.delete(sessionId);
    return true;
  });
  getSessionSnapshotMock.mockClear();
  getSessionDirectoryMock.mockClear();
  abortSessionMock.mockClear();
  abortSessionMock.mockImplementation(async () => {
    if (!workerIsLive) return false;
    workerCompletion.resolve({ status: "completed" });
    return true;
  });
  getProcessValue<{ promise?: Promise<void> }>("worker-startup-sweep", () => ({})).promise =
    undefined;
  log.mockClear();
});

describe("spawnWorker", () => {
  test("inherits its parent's model and worktree directory and deletes after exact completion", async () => {
    const worker = { ...fileWorker, name: "Focused job" };
    const admission = await spawn({
      worker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });

    expect(admission.sessionId).toBe("toy-box-worker");
    expect(await storedWorker()).toEqual(worker);
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Do one focused job.", model: parentModel },
      {
        directory: parentDirectory,
        parentSessionId: "toy-box-parent",
        useWorktree: false,
        name: "Focused job",
      },
    );
    expect(getSessionSnapshotMock).toHaveBeenCalledWith("toy-box-parent");
    expect(getSessionDirectoryMock).toHaveBeenCalledWith("toy-box-parent");
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();

    const completion = workerResult();
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
    const admission = await spawnWorker({
      owner: { type: "session", parentSessionId: "toy-box-parent" },
      sessionId: sessionWorker.sessionId,
      retention: "durable",
      message: { content: "Start work." },
      admit: async (worker) => {
        await workers.create(worker);
        return { title: "Committed work" };
      },
    });
    expect(admission.value).toEqual({ title: "Committed work" });
    expect(await storedWorker()).toEqual(sessionWorker);
    await starting.promise;
    release.resolve();
    workerCompletion.resolve({ status: "completed" });
    await workerResult();
  });

  test("a failed admission rejects and deletes nothing", async () => {
    const existing = { ...sessionWorker, name: "Existing" };
    await workers.create(existing);

    await expect(
      spawn({
        worker: sessionWorker,
        retention: "durable",
        message: { content: "Start work." },
      }),
    ).rejects.toThrow();

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
    expect(await storedWorker()).toEqual(existing);
  });

  test("cancels during persistence without admitting or starting the Worker", async () => {
    const persisting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const spawning = spawn({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Start work." },
      admit: async (worker) => {
        persisting.resolve();
        await release.promise;
        await workers.create(worker);
      },
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
    const spawning = spawn({
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
    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job.", model: explicitModel },
      location: { directory: "/other" },
    });
    workerCompletion.resolve({ status: "completed" });
    await workerResult();

    expect(getSessionDirectoryMock).not.toHaveBeenCalled();
    expect(getSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[0]![1]).toMatchObject({ model: explicitModel });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      directory: "/other",
    });
  });

  test("runs app-owned workers without a parent and deletes them after completion", async () => {
    await spawn({
      worker: appWorker,
      retention: "ephemeral",
      message: { content: "Generate a pattern.", model: explicitModel },
    });
    workerCompletion.resolve({ status: "completed" });
    await workerResult();

    expect(getSessionDirectoryMock).not.toHaveBeenCalled();
    expect(getSessionSnapshotMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledWith(
      "toy-box-worker",
      { content: "Generate a pattern.", model: explicitModel },
      {
        directory: undefined,
        parentSessionId: undefined,
        useWorktree: false,
      },
    );
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("deletes failed workers while preserving their completion result", async () => {
    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Fail this job." },
    });
    workerCompletion.resolve({ status: "failed", response: "Could not finish." });

    await expect(workerResult()).resolves.toEqual({
      status: "failed",
      response: "Could not finish.",
    });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
    expect(log).not.toHaveBeenCalled();
  });

  test("retains coordinated workers after completion", async () => {
    await spawn({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Investigate in parallel." },
      location: { useWorktree: true },
    });
    workerCompletion.resolve({ status: "completed", response: "Findings." });

    await expect(workerResult()).resolves.toEqual({
      status: "completed",
      response: "Findings.",
    });
    expect(createSessionMock.mock.calls[0]![2]).toMatchObject({
      parentSessionId: "toy-box-parent",
      useWorktree: true,
    });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("retains an app-owned worker when it is not ephemeral", async () => {
    const worker = { ...appWorker, ephemeral: false };
    await spawn({
      worker,
      retention: "durable",
      message: { content: "Remain available for follow-up." },
    });
    workerCompletion.resolve({ status: "completed" });

    await workerResult();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("cancels a running worker through its live execution", async () => {
    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    workerIsLive = true;

    await expect(cancelWorker("toy-box-worker")).resolves.toBe(true);
    expect(abortSessionMock).toHaveBeenCalledWith("toy-box-worker");
    await expect(workerResult()).rejects.toBeInstanceOf(WorkerCanceledError);
    await expect(cancelWorker("toy-box-worker")).resolves.toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  test("cleans up a reserved worker id when session creation fails", async () => {
    const creationError = new Error("Unable to create worker.");
    createSessionMock.mockImplementationOnce(async () => {
      throw creationError;
    });

    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await expect(workerResult()).resolves.toEqual({
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
    await spawn({
      worker,
      retention: "durable",
      message: { content: "Keep my submission." },
    });
    await expect(workerResult()).resolves.toEqual({
      status: "failed",
      error: error.message,
    });
    expect(await storedWorker()).toEqual(worker);
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("retains an admitted durable Worker when inheritance fails", async () => {
    const error = new Error("Parent unavailable");
    getSessionSnapshotMock.mockRejectedValueOnce(error);
    const admission = await spawnWorker({
      owner: { type: "session", parentSessionId: "toy-box-parent" },
      sessionId: sessionWorker.sessionId,
      retention: "durable",
      message: { content: "Keep this." },
      admit: async (worker) => {
        await workers.create(worker);
        return false;
      },
    });
    expect(admission.value).toBe(false);
    await expect(workerResult()).resolves.toEqual({
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
    await spawn({
      worker: sessionWorker,
      retention: "durable",
      message: { content: "Cancel me." },
    });
    await starting.promise;
    await cancelWorker(sessionWorker.sessionId);
    release.resolve();
    await expect(workerResult()).rejects.toBeInstanceOf(WorkerCanceledError);
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
    await spawn({
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
    await expect(workerResult()).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
    expect(await cancelWorker("toy-box-worker")).toBe(false);
  });

  test("cleans up a reserved worker id when parent directory loading fails", async () => {
    const directoryError = new Error("Unable to load parent directory.");
    getSessionDirectoryMock.mockImplementationOnce(async () => {
      throw directoryError;
    });

    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    await expect(workerResult()).resolves.toEqual({
      status: "failed",
      error: directoryError.message,
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("toy-box-worker");
  });

  test("sweeps ephemeral workers left by a previous process", async () => {
    for (const sessionId of ["toy-box-worker-b", "toy-box-worker-a"])
      await workers.create({ ...fileWorker, sessionId });
    await workers.create(sessionWorker);

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
    await spawn({
      worker: fileWorker,
      retention: "ephemeral",
      message: { content: "Do one focused job." },
    });
    workerCompletion.resolve({ status: "completed" });

    await expect(workerResult()).rejects.toBe(cleanupError);
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
      await spawn({
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
          await workers.delete(latest.sessionId);
          return true;
        });
      }
      await workers.update(latest.sessionId, { metadata: latest.metadata });
      let completed = false;
      const waiting = workerResult().then((completion) => {
        completed = true;
        return completion;
      });
      workerCompletion.resolve(result);
      await deciding.promise;
      expect(completed).toBe(false);
      expect(await storedWorker()).toEqual(latest);
      decision.resolve(retain);
      if (!retain) {
        await cleaning.promise;
        expect(completed).toBe(false);
        cleanup.resolve();
      }
      await expect(waiting).resolves.toEqual(result);
      if (retain) expect(await storedWorker()).toEqual(latest);
      else expect(await storedWorker()).toBeNull();
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
      await spawn({
        worker: sessionWorker,
        message: { content: "Keep my submission" },
        retention,
      });
      const result = { status: "failed", error: failure.message } satisfies SessionCompletion;
      await expect(workerResult()).resolves.toEqual(result);
      expect(retention).toHaveBeenCalledWith(sessionWorker, result);
      expect(await storedWorker()).toEqual(sessionWorker);
    },
  );

  test("a retention exception preserves ownership and rejects completion", async () => {
    const error = new Error("Retention unavailable");
    await spawn({
      worker: sessionWorker,
      message: { content: "Keep my result if the decision fails" },
      retention: () => {
        throw error;
      },
    });
    workerCompletion.resolve({ status: "completed" });
    await expect(workerResult()).rejects.toBe(error);
    expect(await storedWorker()).toEqual(sessionWorker);
    expect(log).toHaveBeenCalledWith("Worker failed:", error);
  });

  test.each(["canceled", "deleted"])("retention is skipped for %s work", async (action) => {
    const retention = mock(() => false);
    await spawn({
      worker: sessionWorker,
      message: { content: "Stop this work" },
      retention,
    });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalled());
    if (action === "canceled") await cancelWorker(sessionWorker.sessionId);
    else await workers.delete(sessionWorker.sessionId);
    workerCompletion.resolve({ status: "completed" });
    if (action === "canceled")
      await expect(workerResult()).rejects.toBeInstanceOf(WorkerCanceledError);
    else await expect(workerResult()).resolves.toEqual({ status: "completed" });
    expect(retention).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
  });

  test("cancellation during retention takes precedence over automatic deletion", async () => {
    const deciding = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<boolean>();
    await spawn({
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
    await expect(workerResult()).rejects.toBeInstanceOf(WorkerCanceledError);
    expect(await storedWorker()).toEqual(sessionWorker);
  });
});

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  let error: unknown;
  while (performance.now() < deadline) {
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
