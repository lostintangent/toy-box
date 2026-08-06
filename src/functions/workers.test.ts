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
import { join } from "node:path";
import * as runtimeWorkersModule from "@/functions/workers/supervisor";
import { waitForSession } from "@/functions/runtime/stream";
import * as filePathsModule from "@/lib/server/filePaths";
import * as databaseModule from "@/functions/state/database";
import { AppDatabase } from "@/functions/apps/state/database";
import type { SessionCompletion } from "@/types";
import { sessionFile } from "@/lib/files/workspaceFile";
import type { WorkspaceEvent } from "@/types";

const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realFilePathsModule = { ...filePathsModule };
const realDatabaseModule = { ...databaseModule };

let completions: Promise<SessionCompletion>[];
let currentDb: Awaited<ReturnType<typeof databaseModule.createTestDatabase>> | undefined;
const spawnWorkerMock = mock(async (input: runtimeWorkersModule.SpawnWorkerInput) => {
  const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
  return {
    sessionId: input.worker.sessionId,
    waitForCompletion: () => completion,
  };
});
const cancelWorkerMock = mock(async (_sessionId: string) => false);

mock.module("@/functions/workers/supervisor", () => ({
  ...realRuntimeWorkersModule,
  spawnWorker: spawnWorkerMock,
  cancelWorker: cancelWorkerMock,
}));
mock.module("@/lib/server/filePaths", () => ({
  ...realFilePathsModule,
  resolveWorkspaceFile: (file: { path: string }) =>
    file.path === "other.csv" ? join(import.meta.dir, "../../package.json") : import.meta.path,
}));
mock.module("@/functions/state/database", () => ({
  ...realDatabaseModule,
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened.");
    return currentDb;
  },
}));

const { spawnWorkerOnServer, buildWorkerPrompt, cancelWorkerOnServer } =
  await import("@/functions/workers/admission");
const { finishWorker, hasWorker } = await import("@/functions/state/workspace");
const { subscribeWorkspaceEvents } = await import("@/functions/runtime/broadcast");

afterAll(() => {
  mock.module("@/functions/workers/supervisor", () => realRuntimeWorkersModule);
  mock.module("@/lib/server/filePaths", () => realFilePathsModule);
  mock.module("@/functions/state/database", () => realDatabaseModule);
});

beforeEach(() => {
  currentDb = undefined;
  completions = [];
  spawnWorkerMock.mockClear();
  spawnWorkerMock.mockImplementation(async (input) => {
    const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
    return { sessionId: input.worker.sessionId, waitForCompletion: () => completion };
  });
  cancelWorkerMock.mockClear();
  cancelWorkerMock.mockImplementation(async () => false);
});

const file = sessionFile("toy-box-parent", "report.csv");
const input = {
  type: "file" as const,
  file,
  name: "Generate row 18",
  message: { content: "Append one generated row that matches the existing headers." },
  metadata: { type: "generate-row", placeholderId: "row-a" },
};

describe("workers", () => {
  test("returns after admission and projects opaque metadata through workspace events", async () => {
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type.startsWith("worker.")) events.push(event);
    });
    onTestFinished(unsubscribe);

    const { sessionId } = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(sessionId));

    expect(hasWorker(sessionId)).toBe(true);
    expect(events).toEqual([
      {
        type: "worker.started",
        worker: {
          type: "file",
          sessionId,
          ephemeral: true,
          file,
          name: input.name,
          metadata: input.metadata,
        },
      },
    ]);

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      worker: {
        type: "file",
        sessionId,
        ephemeral: true,
        file,
        name: input.name,
        metadata: input.metadata,
      },
      message: { content: expect.stringContaining(input.message.content) },
      directory: undefined,
      useWorktree: undefined,
    });
    expect(spawnWorkerMock.mock.calls[0]![0].message.content).toContain(import.meta.path);

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(sessionId)).toBe(false));
    expect(events.at(-1)).toEqual({ type: "worker.finished", sessionId });
  });

  test("shares an admitted worker's session completion with every waiter", async () => {
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));

    const firstObserver = waitForSession(worker.sessionId);
    expect(waitForSession(worker.sessionId)).toBe(firstObserver);

    completion.resolve({ status: "completed", response: "The row was appended." });
    await expect(firstObserver).resolves.toEqual({
      status: "completed",
      response: "The row was appended.",
    });
    await waitFor(() => expect(hasWorker(worker.sessionId)).toBe(false));
  });

  test("serializes workers for the same file", async () => {
    const first = deferred<SessionCompletion>();
    const second = deferred<SessionCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerOnServer(input);
    const secondWorker = await spawnWorkerOnServer({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishWorker(firstWorker.sessionId));
    onTestFinished(() => finishWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock.mock.calls[0]![0].worker.sessionId).toBe(firstWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls[1]![0].worker.sessionId).toBe(secondWorker.sessionId);

    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
  });

  test("allows workers for different files to execute concurrently", async () => {
    const first = deferred<SessionCompletion>();
    const second = deferred<SessionCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerOnServer(input);
    const secondWorker = await spawnWorkerOnServer({
      ...input,
      file: sessionFile("toy-box-parent", "other.csv"),
    });
    onTestFinished(() => finishWorker(firstWorker.sessionId));
    onTestFinished(() => finishWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
  });

  test("adds the scoped app state contract to an existing app's task", async () => {
    currentDb = await databaseModule.createTestDatabase();
    onTestFinished(async () => currentDb?.close());
    const app = await new AppDatabase(currentDb).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: { pattern: "", flags: "", testText: "1.2.3" },
    });
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);

    const worker = await spawnWorkerOnServer({
      type: "app",
      appId: app.id,
      message: {
        content: "Generate a semantic-version expression.",
        model: { name: "gpt-5" },
      },
      directory: "/repo",
      useWorktree: true,
    });
    onTestFinished(() => finishWorker(worker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock.mock.calls[0]![0]).toMatchObject({
      worker: {
        type: "app",
        sessionId: worker.sessionId,
        ephemeral: true,
        appId: app.id,
      },
      message: { model: { name: "gpt-5" } },
      directory: "/repo",
      useWorktree: true,
    });
    const prompt = spawnWorkerMock.mock.calls[0]![0].message.content;
    expect(prompt).toContain(`app instance ID is "${app.id}"`);
    expect(prompt).toContain("call get_app for the latest state, schema, and revision");
    expect(prompt).toContain("calling update_app");
    expect(prompt).toContain("tools are scoped to this owning app");
    expect(prompt).not.toContain('"testText": "1.2.3"');
    expect(prompt).not.toContain(`current revision is ${app.revision}`);
    expect(prompt).toContain("retry with its revision");
    expect(prompt).toEndWith("Task from the app:\nGenerate a semantic-version expression.");
    expect(prompt).not.toContain("focused background worker for a file");

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(worker.sessionId)).toBe(false));
  });

  test("allows workers for the same app to execute concurrently", async () => {
    currentDb = await databaseModule.createTestDatabase();
    onTestFinished(async () => currentDb?.close());
    const app = await new AppDatabase(currentDb).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: { pattern: "current" },
    });
    const first = deferred<SessionCompletion>();
    const second = deferred<SessionCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerOnServer({
      type: "app",
      appId: app.id,
      message: { content: "First task." },
    });
    const secondWorker = await spawnWorkerOnServer({
      type: "app",
      appId: app.id,
      ephemeral: false,
      message: { content: "Second task." },
    });
    onTestFinished(() => finishWorker(firstWorker.sessionId));
    onTestFinished(() => finishWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls.map(([request]) => request.worker.sessionId).sort()).toEqual(
      [firstWorker.sessionId, secondWorker.sessionId].sort(),
    );
    for (const [request] of spawnWorkerMock.mock.calls) {
      expect(request.message.content).toContain("call get_app");
      expect(request.message.content).not.toContain('"pattern": "current"');
    }
    expect(
      spawnWorkerMock.mock.calls.find(
        ([request]) => request.worker.sessionId === secondWorker.sessionId,
      )?.[0].worker.ephemeral,
    ).toBe(false);

    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
  });

  test("does not start an app worker canceled while its current state is loading", async () => {
    currentDb = await databaseModule.createTestDatabase();
    onTestFinished(async () => currentDb?.close());
    const apps = new AppDatabase(currentDb);
    const app = await apps.create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: {},
    });
    const stateRead = deferred<void>();
    const releaseRead = deferred<void>();
    // oxlint-disable-next-line typescript/unbound-method -- The original method is explicitly rebound with call below.
    const realGet = AppDatabase.prototype.get;
    let reads = 0;
    const get = spyOn(AppDatabase.prototype, "get").mockImplementation(
      async function (this: AppDatabase, appId) {
        const result = await realGet.call(this, appId);
        reads += 1;
        if (reads === 2) {
          stateRead.resolve();
          await releaseRead.promise;
        }
        return result;
      },
    );
    onTestFinished(() => get.mockRestore());

    const worker = await spawnWorkerOnServer({
      type: "app",
      appId: app.id,
      message: { content: "Generate a pattern." },
    });
    onTestFinished(() => finishWorker(worker.sessionId));
    await stateRead.promise;

    await expect(
      cancelWorkerOnServer({
        type: "app",
        appId: app.id,
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(true);
    releaseRead.resolve();

    await waitFor(() => expect(hasWorker(worker.sessionId)).toBe(false));
    expect(spawnWorkerMock).not.toHaveBeenCalled();
  });

  test("rejects workers for missing apps", async () => {
    currentDb = await databaseModule.createTestDatabase();
    onTestFinished(async () => currentDb?.close());

    await expect(
      spawnWorkerOnServer({
        type: "app",
        appId: "missing-app",
        message: { content: "Generate a pattern." },
      }),
    ).rejects.toThrow("existing app");
    expect(spawnWorkerMock).not.toHaveBeenCalled();
  });

  test("removes queued work before its file queue admits it", async () => {
    const first = deferred<SessionCompletion>();
    completions.push(first.promise);

    const firstWorker = await spawnWorkerOnServer(input);
    const queuedWorker = await spawnWorkerOnServer({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishWorker(firstWorker.sessionId));
    onTestFinished(() => finishWorker(queuedWorker.sessionId));
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));

    await expect(
      cancelWorkerOnServer({ type: "file", file, workerSessionId: queuedWorker.sessionId }),
    ).resolves.toBe(true);
    expect(hasWorker(queuedWorker.sessionId)).toBe(false);
    expect(cancelWorkerMock).toHaveBeenCalledWith(queuedWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(firstWorker.sessionId)).toBe(false));
    expect(spawnWorkerMock).toHaveBeenCalledTimes(1);
  });

  test("cancels admitted work and clears its file registration immediately", async () => {
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);
    cancelWorkerMock.mockImplementationOnce(async () => true);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));

    await expect(
      cancelWorkerOnServer({ type: "file", file, workerSessionId: worker.sessionId }),
    ).resolves.toBe(true);
    expect(hasWorker(worker.sessionId)).toBe(false);
    expect(cancelWorkerMock).toHaveBeenCalledWith(worker.sessionId);

    completion.resolve({ status: "completed" });
  });

  test("does not cancel a worker through a different file", async () => {
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));

    await expect(
      cancelWorkerOnServer({
        type: "file",
        file: sessionFile("toy-box-parent", "other.csv"),
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(false);
    expect(hasWorker(worker.sessionId)).toBe(true);
    expect(cancelWorkerMock).not.toHaveBeenCalled();

    completion.resolve({ status: "completed" });
  });

  test("rejects completion waiters when their worker is canceled", async () => {
    const completion = deferred<SessionCompletion>();
    completions.push(completion.promise);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));
    const request = { type: "file" as const, file, workerSessionId: worker.sessionId };
    const completionWait = waitForSession(worker.sessionId);

    await expect(cancelWorkerOnServer(request)).resolves.toBe(true);
    await expect(completionWait).rejects.toBeInstanceOf(
      realRuntimeWorkersModule.WorkerCanceledError,
    );
    completion.resolve({ status: "completed" });
  });

  test("finishes the registration when the runtime cannot spawn the worker", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    spawnWorkerMock.mockImplementationOnce(async () => {
      throw new Error("Unable to spawn.");
    });

    const { sessionId } = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(sessionId));
    await waitFor(() => expect(hasWorker(sessionId)).toBe(false));
    await waitFor(() => expect(log).toHaveBeenCalled());
  });

  test("continues queued work after a worker fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const secondCompletion = deferred<SessionCompletion>();
    completions.push(secondCompletion.promise);
    spawnWorkerMock.mockImplementationOnce(async () => {
      throw new Error("Unable to spawn.");
    });

    const failedWorker = await spawnWorkerOnServer(input);
    const nextWorker = await spawnWorkerOnServer({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishWorker(failedWorker.sessionId));
    onTestFinished(() => finishWorker(nextWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls[1]![0].worker.sessionId).toBe(nextWorker.sessionId);

    secondCompletion.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(nextWorker.sessionId)).toBe(false));
  });

  test("finishes the registration when the worker does not complete", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    completions.push(Promise.resolve({ status: "failed" }));

    const { sessionId } = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(sessionId));
    await waitFor(() => expect(hasWorker(sessionId)).toBe(false));

    expect(log).toHaveBeenCalled();
  });
});

describe("worker prompt", () => {
  test("adds only the file-wide execution contract", () => {
    const prompt = buildWorkerPrompt("Append one CSV row.", {
      type: "file",
      absolutePath: "/tmp/session/files/report.csv",
    });

    expect(prompt).toContain("/tmp/session/files/report.csv");
    expect(prompt).toContain("Read that exact file immediately before acting");
    expect(prompt).toContain("do not leave the result only in your final response");
    expect(prompt).toContain("Append one CSV row.");
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
