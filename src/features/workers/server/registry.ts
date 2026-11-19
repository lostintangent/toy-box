// Process-local registry of in-flight worker runs. Canonical session state
// remains the execution lifecycle authority.

import type { SessionCompletion } from "@sessions/model";
import { abortSession, expectSessionCompletion } from "@sessions/server/runtime";
import { sharedMap } from "@/shared/server/processState";
import { broadcast } from "@workspace/server/events";
import type { Worker } from "../model";

/** A canceled run stops being active at once and holds its ID until it settles. */
type WorkerRun = { worker: Worker; cancel: AbortController };

const runs = sharedMap<WorkerRun>("worker-runs");

export function getActiveWorkers(): Worker[] {
  return [...runs.values()].filter(isActive).map(({ worker }) => worker);
}

export function getActiveWorker(sessionId: string): Worker | undefined {
  const run = runs.get(sessionId);
  return run && isActive(run) ? run.worker : undefined;
}

/** Run a worker that has none in flight. It is waitable by ID before it is announced. */
export function startWorkerRun(
  worker: Worker,
  execute: (signal: AbortSignal) => Promise<SessionCompletion>,
): Promise<SessionCompletion> {
  const { sessionId } = worker;
  if (runs.has(sessionId)) throw new Error(`Worker ${sessionId} already has a run.`);
  const run = { worker, cancel: new AbortController() };
  runs.set(sessionId, run);
  const completion = execute(run.cancel.signal);
  expectSessionCompletion(sessionId, completion.catch(canceledCompletion));
  broadcast({ type: "worker.started", worker });
  const finish = () => {
    runs.delete(sessionId);
    if (isActive(run)) broadcast({ type: "worker.finished", sessionId });
  };
  void completion.then(finish, finish);
  return completion;
}

/** Cancel a worker whether its session is still spawning or already running. */
export async function cancelWorker(sessionId: string): Promise<boolean> {
  const run = runs.get(sessionId);
  if (!run || !isActive(run)) return false;
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

/** Waiters see a canceled run as failed data. Supervision keeps the rejection, which skips retention. */
function canceledCompletion(error: unknown): SessionCompletion {
  if (error instanceof WorkerCanceledError) return { status: "failed", error: error.message };
  throw error;
}

function isActive(run: WorkerRun): boolean {
  return !run.cancel.signal.aborted;
}
