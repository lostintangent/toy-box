// Process-local associations between artifacts and their pending workers.
// Canonical session state remains the execution lifecycle authority.

import { sharedMap } from "@/functions/runtime/processState";
import type { ArtifactWorker } from "@/types";

const workers = sharedMap<ArtifactWorker>("artifact-workers");

export function getArtifactWorkers(): ArtifactWorker[] {
  return [...workers.values()];
}

export function hasArtifactWorker(sessionId: string): boolean {
  return workers.has(sessionId);
}

export function getArtifactWorker(sessionId: string): ArtifactWorker | undefined {
  return workers.get(sessionId);
}

/** A reserved worker id has one immutable artifact association. */
export function startArtifactWorker(worker: ArtifactWorker): boolean {
  if (workers.has(worker.sessionId)) return false;
  workers.set(worker.sessionId, worker);
  return true;
}

export function finishArtifactWorker(sessionId: string): boolean {
  return workers.delete(sessionId);
}

export function finishArtifactWorkersForSession(sessionId: string): string[] {
  const finished: string[] = [];
  for (const [workerSessionId, worker] of workers) {
    if (workerSessionId !== sessionId && worker.sourceSessionId !== sessionId) continue;
    workers.delete(workerSessionId);
    finished.push(workerSessionId);
  }
  return finished;
}
