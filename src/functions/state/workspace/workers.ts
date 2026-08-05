// Process-local registry of queued and running workers. Canonical session state
// remains the execution lifecycle authority.

import { sharedMap } from "@/functions/runtime/processState";
import { workerReferencesSession } from "@/lib/workers";
import type { Worker } from "@/types";

const workers = sharedMap<Worker>("workers");

export function getWorkers(): Worker[] {
  return [...workers.values()];
}

export function hasWorker(sessionId: string): boolean {
  return workers.has(sessionId);
}

export function getWorker(sessionId: string): Worker | undefined {
  return workers.get(sessionId);
}

/** A reserved worker id has one immutable registration. */
export function startWorker(worker: Worker): boolean {
  if (workers.has(worker.sessionId)) return false;
  workers.set(worker.sessionId, worker);
  return true;
}

export function finishWorker(sessionId: string): boolean {
  return workers.delete(sessionId);
}

export function finishWorkersForSession(sessionId: string): string[] {
  return finishWorkers((worker) => workerReferencesSession(worker, sessionId));
}

export function finishWorkersForApp(appId: string): string[] {
  return finishWorkers((worker) => worker.type === "app" && worker.appId === appId);
}

function finishWorkers(matches: (worker: Worker) => boolean): string[] {
  const finished: string[] = [];
  for (const [workerSessionId, worker] of workers) {
    if (!matches(worker)) continue;
    workers.delete(workerSessionId);
    finished.push(workerSessionId);
  }
  return finished;
}
