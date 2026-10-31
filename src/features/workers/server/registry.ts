// Process-local registry of pending workers. Canonical session state
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

export function getRegisteredWorker(sessionId: string): Worker | undefined {
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

export function finishWorkersForSession(sessionId: string): void {
  for (const worker of workers.values()) {
    if (workerReferencesSession(worker, sessionId)) finishWorker(worker.sessionId);
  }
}
