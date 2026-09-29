import { deleteSessionIfExists } from "@sessions/server/runtime";
import {
  getPersistedWorker,
  getWorkerSessionIdsForApp,
  getWorkerSessionIdsForParent,
} from "./database";
import { cancelAdmittedWorker } from "./admission";
import { finishWorkersForApp, finishWorkersOwnedBySession, getWorker } from "./registry";
import type { Worker } from "../model";

/** Remove every worker owned by a deleted session, including file workers. */
export async function deleteWorkersForSession(sessionId: string): Promise<void> {
  const sessionIds = new Set([
    ...finishWorkersOwnedBySession(sessionId),
    ...(await getWorkerSessionIdsForParent(sessionId)),
  ]);
  const errors = await deleteWorkers(sessionIds);
  if (errors.length > 0) {
    throw new AggregateError(errors, `Unable to clean up workers owned by ${sessionId}.`);
  }
}

/** Remove every live or retained worker owned by a deleted app. */
export async function deleteWorkersForApp(appId: string): Promise<void> {
  const sessionIds = new Set([
    ...finishWorkersForApp(appId),
    ...(await getWorkerSessionIdsForApp(appId)),
  ]);
  for (const error of await deleteWorkers(sessionIds)) {
    console.error("Unable to clean up an app worker:", error);
  }
}

async function deleteWorkers(sessionIds: ReadonlySet<string>): Promise<unknown[]> {
  const cleanup = await Promise.allSettled([...sessionIds].map((id) => deleteWorker(id)));
  return cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

export async function deleteWorker(sessionId: string, type?: Worker["type"]): Promise<boolean> {
  if (type) {
    const worker = (await getPersistedWorker(sessionId)) ?? getWorker(sessionId);
    if (worker?.type !== type) return false;
  }
  const errors: unknown[] = [];
  try {
    await cancelAdmittedWorker(sessionId);
  } catch (error) {
    errors.push(error);
  }
  try {
    await deleteSessionIfExists(sessionId);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `Unable to cancel or delete worker ${sessionId}.`);
  }
  return true;
}
