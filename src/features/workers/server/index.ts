import { getStateDatabase } from "@/server/database";
import type { Worker, WorkerOwner } from "../model";
import { WorkerDatabase } from "./database";
import { getActiveWorker } from "./registry";

export { deleteWorker, deleteWorkersForApp, deleteWorkersForSession } from "./cleanup";
export { spawnWorker } from "./supervisor";

/** List retained Workers, optionally only for one owner. */
export async function listWorkers<Type extends Worker["type"]>(
  scope?: Type | Extract<WorkerOwner, { type: Type }>,
): Promise<Extract<Worker, { type: Type }>[]> {
  return new WorkerDatabase(await getStateDatabase()).list(scope);
}

/** Resolve a retained Worker, optionally only for one owner. */
export async function getWorker<Type extends Worker["type"] = Worker["type"]>(
  sessionId: string,
  scope?: Type | Extract<WorkerOwner, { type: Type }>,
): Promise<Extract<Worker, { type: Type }> | null> {
  return new WorkerDatabase(await getStateDatabase()).get(sessionId, scope);
}

/** Whether a Worker has a run in flight, as opposed to only retained ownership. */
export function isWorkerActive(sessionId: string): boolean {
  return getActiveWorker(sessionId) !== undefined;
}

/** Update a Worker by ID without changing ownership, identity, or lifetime. */
export async function updateWorker(
  sessionId: string,
  details: Pick<Worker, "name"> & { metadata?: unknown },
): Promise<void> {
  const updated = await new WorkerDatabase(await getStateDatabase()).update(sessionId, details);
  if (!updated) throw new Error("Worker not found.");
}

/** Returns false when metadata is already present or ownership no longer matches. */
export async function initializeWorkerMetadata(
  sessionId: string,
  type: Worker["type"],
  metadata: Worker["metadata"],
): Promise<boolean> {
  return new WorkerDatabase(await getStateDatabase()).initializeMetadata(sessionId, type, metadata);
}

/** Forget a Worker's ownership once its Session is already gone. */
export async function detachWorker(sessionId: string): Promise<void> {
  await new WorkerDatabase(await getStateDatabase()).delete(sessionId);
}
