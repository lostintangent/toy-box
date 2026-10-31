import { expect, onTestFinished, test } from "bun:test";
import { sessionFile } from "@files/model";
import type { WorkspaceEvent } from "@workspace/model/events";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { finishWorker, getRegisteredWorker, startWorker } from "./registry";

test("registers a worker once and announces its start and finish once", () => {
  const worker = {
    createdAt: new Date(0).toISOString(),
    type: "file" as const,
    sessionId: `artifact-worker-${crypto.randomUUID()}`,
    ephemeral: true,
    file: sessionFile(`artifact-source-${crypto.randomUUID()}`, "plan.md"),
    name: "Respond to comment",
    metadata: { threadId: "thread-a" },
  };
  onTestFinished(() => finishWorker(worker.sessionId));
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (
      (event.type === "worker.started" && event.worker.sessionId === worker.sessionId) ||
      (event.type === "worker.finished" && event.sessionId === worker.sessionId)
    ) {
      events.push(event);
    }
  });
  onTestFinished(unsubscribe);

  startWorker(worker);
  startWorker({ ...worker, metadata: { ignored: true } });
  expect(getRegisteredWorker(worker.sessionId)).toEqual(worker);

  finishWorker(worker.sessionId);
  finishWorker(worker.sessionId);
  expect(getRegisteredWorker(worker.sessionId)).toBeUndefined();
  expect(events).toEqual([
    { type: "worker.started", worker },
    { type: "worker.finished", sessionId: worker.sessionId },
  ]);
});
