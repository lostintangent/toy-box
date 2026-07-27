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
import * as runtimeWorkersModule from "@/functions/runtime/workers";
import * as filePathsModule from "@/lib/server/filePaths";
import type { SessionStreamCompletion } from "@/functions/runtime/stream";
import { sessionFile } from "@/lib/files/workspaceFile";
import type { WorkspaceEvent } from "@/types";

const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realFilePathsModule = { ...filePathsModule };

let completions: Promise<SessionStreamCompletion>[];
const spawnWorkerMock = mock(async (input: runtimeWorkersModule.SpawnWorkerInput) => {
  const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
  return {
    sessionId: input.sessionId!,
    waitForCompletion: () => completion,
  };
});
const stopWorkerMock = mock(async (_sessionId: string) => false);

mock.module("@/functions/runtime/workers", () => ({
  ...realRuntimeWorkersModule,
  spawnWorker: spawnWorkerMock,
  stopWorker: stopWorkerMock,
}));
mock.module("@/lib/server/filePaths", () => ({
  ...realFilePathsModule,
  resolveWorkspaceFile: (file: { path: string }) =>
    file.path === "other.csv" ? join(import.meta.dir, "../../package.json") : import.meta.path,
}));

const { spawnWorkerOnServer, buildWorkerPrompt, cancelWorkerOnServer } =
  await import("@/functions/workers/admission");
const { finishWorker, hasWorker } = await import("@/functions/state/workspace");
const { subscribeWorkspaceEvents } = await import("@/functions/runtime/broadcast");

afterAll(() => {
  mock.module("@/functions/runtime/workers", () => realRuntimeWorkersModule);
  mock.module("@/lib/server/filePaths", () => realFilePathsModule);
});

beforeEach(() => {
  completions = [];
  spawnWorkerMock.mockClear();
  spawnWorkerMock.mockImplementation(async (input) => {
    const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
    return { sessionId: input.sessionId!, waitForCompletion: () => completion };
  });
  stopWorkerMock.mockClear();
  stopWorkerMock.mockImplementation(async () => false);
});

const file = sessionFile("toy-box-parent", "report.csv");
const input = {
  file,
  name: "Generate row 18",
  prompt: "Append one generated row that matches the existing headers.",
  metadata: { type: "generate-row", placeholderId: "row-a" },
};

describe("workers", () => {
  test("returns after admission and projects opaque metadata through workspace events", async () => {
    const completion = deferred<SessionStreamCompletion>();
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
          sessionId,
          file: input.file,
          name: input.name,
          metadata: input.metadata,
        },
      },
    ]);

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      sessionId,
      parentSessionId: "toy-box-parent",
      name: input.name,
      task: expect.stringContaining(input.prompt),
    });
    expect(spawnWorkerMock.mock.calls[0]![0].task).toContain(import.meta.path);

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(sessionId)).toBe(false));
    expect(events.at(-1)).toEqual({ type: "worker.finished", sessionId });
  });

  test("serializes workers for the same file", async () => {
    const first = deferred<SessionStreamCompletion>();
    const second = deferred<SessionStreamCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerOnServer(input);
    const secondWorker = await spawnWorkerOnServer({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishWorker(firstWorker.sessionId));
    onTestFinished(() => finishWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock.mock.calls[0]![0].sessionId).toBe(firstWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls[1]![0].sessionId).toBe(secondWorker.sessionId);

    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
  });

  test("allows workers for different files to execute concurrently", async () => {
    const first = deferred<SessionStreamCompletion>();
    const second = deferred<SessionStreamCompletion>();
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

  test("removes queued work before its file queue admits it", async () => {
    const first = deferred<SessionStreamCompletion>();
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
      cancelWorkerOnServer({ file, workerSessionId: queuedWorker.sessionId }),
    ).resolves.toBe(true);
    expect(hasWorker(queuedWorker.sessionId)).toBe(false);
    expect(stopWorkerMock).toHaveBeenCalledWith(queuedWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(firstWorker.sessionId)).toBe(false));
    expect(spawnWorkerMock).toHaveBeenCalledTimes(1);
  });

  test("stops admitted work and clears its file registration immediately", async () => {
    const completion = deferred<SessionStreamCompletion>();
    completions.push(completion.promise);
    stopWorkerMock.mockImplementationOnce(async () => true);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));

    await expect(cancelWorkerOnServer({ file, workerSessionId: worker.sessionId })).resolves.toBe(
      true,
    );
    expect(hasWorker(worker.sessionId)).toBe(false);
    expect(stopWorkerMock).toHaveBeenCalledWith(worker.sessionId);

    completion.resolve({ status: "completed" });
  });

  test("does not cancel a worker through a different file", async () => {
    const completion = deferred<SessionStreamCompletion>();
    completions.push(completion.promise);
    const worker = await spawnWorkerOnServer(input);
    onTestFinished(() => finishWorker(worker.sessionId));

    await expect(
      cancelWorkerOnServer({
        file: sessionFile("toy-box-parent", "other.csv"),
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(false);
    expect(hasWorker(worker.sessionId)).toBe(true);
    expect(stopWorkerMock).not.toHaveBeenCalled();

    completion.resolve({ status: "completed" });
  });

  test("rejects a machine file, which has no owning session to parent a worker", async () => {
    await expect(
      spawnWorkerOnServer({ ...input, file: { type: "machine", path: "/tmp/report.csv" } }),
    ).rejects.toThrow("session-owned file");
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
    const secondCompletion = deferred<SessionStreamCompletion>();
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
    expect(spawnWorkerMock.mock.calls[1]![0].sessionId).toBe(nextWorker.sessionId);

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
    const prompt = buildWorkerPrompt("Append one CSV row.", "/tmp/session/files/report.csv");

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
