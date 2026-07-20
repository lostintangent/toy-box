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
import * as artifactPathsModule from "@/functions/artifacts/paths";
import type { SessionStreamCompletion } from "@/functions/runtime/stream";
import type { WorkspaceEvent } from "@/types";
import type { SpawnArtifactWorkerInput } from "./workers";

const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realArtifactPathsModule = { ...artifactPathsModule };

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
mock.module("@/functions/artifacts/paths", () => ({
  ...realArtifactPathsModule,
  resolveArtifactPath: async (_sessionId: string, path: string) =>
    path === "other.csv" ? join(import.meta.dir, "../../../package.json") : import.meta.path,
}));

const { buildArtifactWorkerPrompt, cancelArtifactWorker, spawnArtifactWorker } =
  await import("./workers");
const { finishArtifactWorker, hasArtifactWorker } = await import("@/functions/state/workspace");
const { subscribeWorkspaceEvents } = await import("@/functions/runtime/broadcast");

afterAll(() => {
  mock.module("@/functions/runtime/workers", () => realRuntimeWorkersModule);
  mock.module("@/functions/artifacts/paths", () => realArtifactPathsModule);
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

const input: SpawnArtifactWorkerInput = {
  sessionId: "toy-box-parent",
  path: "report.csv",
  name: "Generate row 18",
  prompt: "Append one generated row that matches the existing headers.",
  metadata: { type: "generate-row", placeholderId: "row-a" },
};

describe("artifact workers", () => {
  test("returns after admission and projects opaque metadata through workspace events", async () => {
    const completion = deferred<SessionStreamCompletion>();
    completions.push(completion.promise);
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type.startsWith("artifact.worker.")) events.push(event);
    });
    onTestFinished(unsubscribe);

    const { sessionId } = await spawnArtifactWorker(input);
    onTestFinished(() => finishArtifactWorker(sessionId));

    expect(hasArtifactWorker(sessionId)).toBe(true);
    expect(events).toEqual([
      {
        type: "artifact.worker.started",
        worker: {
          sessionId,
          sourceSessionId: input.sessionId,
          path: input.path,
          name: input.name,
          metadata: input.metadata,
        },
      },
    ]);

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      sessionId,
      parentSessionId: input.sessionId,
      name: input.name,
      task: expect.stringContaining(input.prompt),
    });
    expect(spawnWorkerMock.mock.calls[0]![0].task).toContain(import.meta.path);

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(hasArtifactWorker(sessionId)).toBe(false));
    expect(events.at(-1)).toEqual({ type: "artifact.worker.finished", sessionId });
  });

  test("serializes workers for the same artifact", async () => {
    const first = deferred<SessionStreamCompletion>();
    const second = deferred<SessionStreamCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnArtifactWorker(input);
    const secondWorker = await spawnArtifactWorker({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishArtifactWorker(firstWorker.sessionId));
    onTestFinished(() => finishArtifactWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock.mock.calls[0]![0].sessionId).toBe(firstWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls[1]![0].sessionId).toBe(secondWorker.sessionId);

    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasArtifactWorker(secondWorker.sessionId)).toBe(false));
  });

  test("allows workers for different artifacts to execute concurrently", async () => {
    const first = deferred<SessionStreamCompletion>();
    const second = deferred<SessionStreamCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnArtifactWorker(input);
    const secondWorker = await spawnArtifactWorker({ ...input, path: "other.csv" });
    onTestFinished(() => finishArtifactWorker(firstWorker.sessionId));
    onTestFinished(() => finishArtifactWorker(secondWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasArtifactWorker(secondWorker.sessionId)).toBe(false));
  });

  test("removes queued work before its artifact queue admits it", async () => {
    const first = deferred<SessionStreamCompletion>();
    completions.push(first.promise);

    const firstWorker = await spawnArtifactWorker(input);
    const queuedWorker = await spawnArtifactWorker({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishArtifactWorker(firstWorker.sessionId));
    onTestFinished(() => finishArtifactWorker(queuedWorker.sessionId));
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));

    await expect(
      cancelArtifactWorker({
        sessionId: input.sessionId,
        path: input.path,
        workerSessionId: queuedWorker.sessionId,
      }),
    ).resolves.toBe(true);
    expect(hasArtifactWorker(queuedWorker.sessionId)).toBe(false);
    expect(stopWorkerMock).toHaveBeenCalledWith(queuedWorker.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(hasArtifactWorker(firstWorker.sessionId)).toBe(false));
    expect(spawnWorkerMock).toHaveBeenCalledTimes(1);
  });

  test("stops admitted work and clears its artifact association immediately", async () => {
    const completion = deferred<SessionStreamCompletion>();
    completions.push(completion.promise);
    stopWorkerMock.mockImplementationOnce(async () => true);
    const worker = await spawnArtifactWorker(input);
    onTestFinished(() => finishArtifactWorker(worker.sessionId));
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));

    await expect(
      cancelArtifactWorker({
        sessionId: input.sessionId,
        path: input.path,
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(true);
    expect(hasArtifactWorker(worker.sessionId)).toBe(false);
    expect(stopWorkerMock).toHaveBeenCalledWith(worker.sessionId);

    completion.resolve({ status: "completed" });
  });

  test("does not cancel a worker through a different artifact address", async () => {
    const completion = deferred<SessionStreamCompletion>();
    completions.push(completion.promise);
    const worker = await spawnArtifactWorker(input);
    onTestFinished(() => finishArtifactWorker(worker.sessionId));

    await expect(
      cancelArtifactWorker({
        sessionId: input.sessionId,
        path: "other.csv",
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(false);
    expect(hasArtifactWorker(worker.sessionId)).toBe(true);
    expect(stopWorkerMock).not.toHaveBeenCalled();

    completion.resolve({ status: "completed" });
  });

  test("finishes the association when the runtime cannot spawn the worker", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    spawnWorkerMock.mockImplementationOnce(async () => {
      throw new Error("Unable to spawn.");
    });

    const { sessionId } = await spawnArtifactWorker(input);
    onTestFinished(() => finishArtifactWorker(sessionId));
    await waitFor(() => expect(hasArtifactWorker(sessionId)).toBe(false));
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

    const failedWorker = await spawnArtifactWorker(input);
    const nextWorker = await spawnArtifactWorker({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    onTestFinished(() => finishArtifactWorker(failedWorker.sessionId));
    onTestFinished(() => finishArtifactWorker(nextWorker.sessionId));

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));
    expect(spawnWorkerMock.mock.calls[1]![0].sessionId).toBe(nextWorker.sessionId);

    secondCompletion.resolve({ status: "completed" });
    await waitFor(() => expect(hasArtifactWorker(nextWorker.sessionId)).toBe(false));
  });

  test("finishes the association when the worker does not complete", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    completions.push(Promise.resolve({ status: "failed" }));

    const { sessionId } = await spawnArtifactWorker(input);
    onTestFinished(() => finishArtifactWorker(sessionId));
    await waitFor(() => expect(hasArtifactWorker(sessionId)).toBe(false));

    expect(log).toHaveBeenCalled();
  });
});

describe("artifact worker prompt", () => {
  test("adds only the artifact-wide execution contract", () => {
    const prompt = buildArtifactWorkerPrompt(
      "Append one CSV row.",
      "/tmp/session/files/report.csv",
    );

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
