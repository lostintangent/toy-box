// Process-local registry of queued and running workers. Canonical session state
// remains the execution lifecycle authority.

import { sharedMap } from "@/shared/server/processState";
import { broadcast } from "@workspace/server/events";
import { workerReferencesSession, type Worker } from "../model";

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
export function startWorker(worker: Worker): void {
  if (workers.has(worker.sessionId)) return;
  workers.set(worker.sessionId, worker);
  broadcast({ type: "worker.started", worker });
}

export function finishWorker(sessionId: string): void {
  if (!workers.delete(sessionId)) return;
  broadcast({ type: "worker.finished", sessionId });
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
    broadcast({ type: "worker.finished", sessionId: workerSessionId });
    finished.push(workerSessionId);
  }
  return finished;
}
