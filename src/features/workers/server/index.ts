import { getStateDatabase } from "@/server/database";
import type { Worker, WorkerOwner } from "../model";
import { WorkerDatabase } from "./database";

export { deleteWorker, deleteWorkersForApp, deleteWorkersForSession } from "./cleanup";
export { spawnSessionWorker, spawnWorker } from "./admission";
export type { WorkerSpawn } from "./admission";
export type { WorkerReceipt, WorkerRetention } from "./supervisor";
export { WorkerCanceledError } from "./supervisor";
export { getWorkers as getActiveWorkers } from "./registry";

export async function listWorkers<Type extends Worker["type"]>(
  scope: Type | Extract<WorkerOwner, { type: Type }>,
): Promise<Extract<Worker, { type: Type }>[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  return db ? new WorkerDatabase(db).list(scope) : [];
}

export async function getWorker<Type extends Worker["type"]>(
  sessionId: string,
  scope: Type | Extract<WorkerOwner, { type: Type }>,
): Promise<Extract<Worker, { type: Type }> | null> {
  const db = await getStateDatabase({ createIfMissing: false });
  return db ? new WorkerDatabase(db).get(sessionId, scope) : null;
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
