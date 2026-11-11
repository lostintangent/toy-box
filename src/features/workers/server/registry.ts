// Process-local registry of in-flight worker runs. Canonical session state
// remains the execution lifecycle authority.

import type { SessionCompletion } from "@sessions/model";
import { abortSession, expectSessionCompletion } from "@sessions/server/runtime";
import { sharedMap } from "@/shared/server/processState";
import { broadcast } from "@workspace/server/events";
import type { Worker } from "../model";

/** A canceled run leaves the listing at once and stays registered until it settles. */
type WorkerRun = { worker: Worker; cancel: AbortController };

const runs = sharedMap<WorkerRun>("worker-runs");

export function getWorkers(): Worker[] {
  return [...runs.values()].filter(isListed).map(({ worker }) => worker);
}

export function hasWorker(sessionId: string): boolean {
  return getRegisteredWorker(sessionId) !== undefined;
}

export function getRegisteredWorker(sessionId: string): Worker | undefined {
  const run = runs.get(sessionId);
  return run && isListed(run) ? run.worker : undefined;
}

/** Run a worker that has none in flight. It is waitable by ID before it is announced. */
export function startWorkerRun(
  worker: Worker,
  execute: (signal: AbortSignal) => Promise<SessionCompletion>,
): Promise<SessionCompletion> {
  const { sessionId } = worker;
  if (runs.has(sessionId)) throw new Error(`Worker ${sessionId} is already active.`);
  const run = { worker, cancel: new AbortController() };
  runs.set(sessionId, run);
  const completion = execute(run.cancel.signal);
  expectSessionCompletion(sessionId, completion);
  broadcast({ type: "worker.started", worker });
  const finish = () => {
    runs.delete(sessionId);
    if (isListed(run)) broadcast({ type: "worker.finished", sessionId });
  };
  void completion.then(finish, finish);
  return completion;
}

/** Cancel a worker whether its session is still spawning or already running. */
export async function cancelWorker(sessionId: string): Promise<boolean> {
  const run = runs.get(sessionId);
  if (!run || !isListed(run)) return false;
  run.cancel.abort(new WorkerCanceledError(sessionId));
  broadcast({ type: "worker.finished", sessionId });
  await abortSession(sessionId);
  return true;
}

export class WorkerCanceledError extends Error {
  constructor(sessionId: string) {
    super(`Worker ${sessionId} was canceled.`);
    this.name = "WorkerCanceledError";
  }
}

function isListed(run: WorkerRun): boolean {
  return !run.cancel.signal.aborted;
}
