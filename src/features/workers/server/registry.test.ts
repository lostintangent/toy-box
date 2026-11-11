import { expect, onTestFinished, test } from "bun:test";
import { sessionFile } from "@files/model";
import type { SessionCompletion } from "@sessions/model";
import { waitForSessions } from "@sessions/server/runtime";
import type { WorkspaceEvent } from "@workspace/model/events";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import {
  cancelWorker,
  getRegisteredWorker,
  getWorkers,
  startWorkerRun,
  WorkerCanceledError,
} from "./registry";

function startRun() {
  const worker = {
    createdAt: new Date(0).toISOString(),
    type: "file" as const,
    sessionId: `artifact-worker-${crypto.randomUUID()}`,
    ephemeral: true,
    file: sessionFile(`artifact-source-${crypto.randomUUID()}`, "plan.md"),
    name: "Respond to comment",
    metadata: { threadId: "thread-a" },
  };
  const events: WorkspaceEvent[] = [];
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (
        (event.type === "worker.started" && event.worker.sessionId === worker.sessionId) ||
        (event.type === "worker.finished" && event.sessionId === worker.sessionId)
      ) {
        events.push(event);
      }
    }),
  );
  const execution = Promise.withResolvers<SessionCompletion>();
  let signal!: AbortSignal;
  const completion = startWorkerRun(worker, (runSignal) => {
    signal = runSignal;
    return execution.promise;
  });
  void completion.catch(() => {});
  onTestFinished(() => execution.resolve({ status: "completed" }));
  return { worker, events, execution, completion, signal };
}

test("runs a worker once, waitable by ID, and announces its start and finish once", async () => {
  const { worker, events, execution, completion } = startRun();
  const waiters = [waitForSessions([worker.sessionId]), waitForSessions([worker.sessionId])];

  expect(getRegisteredWorker(worker.sessionId)).toEqual(worker);
  expect(getWorkers()).toContainEqual(worker);
  expect(() => startWorkerRun(worker, () => execution.promise)).toThrow(
    `Worker ${worker.sessionId} is already active.`,
  );

  execution.resolve({ status: "completed", response: "Replied." });
  await completion;
  await expect(Promise.all(waiters)).resolves.toEqual([
    [{ status: "completed", response: "Replied." }],
    [{ status: "completed", response: "Replied." }],
  ]);
  expect(getRegisteredWorker(worker.sessionId)).toBeUndefined();
  expect(events).toEqual([
    { type: "worker.started", worker },
    { type: "worker.finished", sessionId: worker.sessionId },
  ]);
});

test("a canceled run leaves the listing at once and holds its ID until it settles", async () => {
  const { worker, events, execution, completion, signal } = startRun();

  expect(await cancelWorker(worker.sessionId)).toBe(true);
  expect(signal.reason).toBeInstanceOf(WorkerCanceledError);
  expect(getRegisteredWorker(worker.sessionId)).toBeUndefined();
  expect(getWorkers()).not.toContainEqual(worker);
  expect(await cancelWorker(worker.sessionId)).toBe(false);
  expect(() => startWorkerRun(worker, () => execution.promise)).toThrow("already active");

  execution.reject(signal.reason);
  await expect(completion).rejects.toBe(signal.reason);
  expect(events).toEqual([
    { type: "worker.started", worker },
    { type: "worker.finished", sessionId: worker.sessionId },
  ]);
});
