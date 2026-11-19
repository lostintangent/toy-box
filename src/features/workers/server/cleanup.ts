import { deleteSession } from "@sessions/server/runtime";
import { getStateDatabase } from "@/server/database";
import { WorkerDatabase } from "./database";
import { cancelWorker, getActiveWorker, getActiveWorkers } from "./registry";
import { workerParentSessionId, type Worker } from "../model";

/** Remove every worker owned by a deleted session, including file workers. */
export async function deleteWorkersForSession(sessionId: string): Promise<void> {
  const sessionIds = new Set([
    ...getActiveWorkers()
      .filter((worker) => workerParentSessionId(worker) === sessionId)
      .map((worker) => worker.sessionId),
    ...(await new WorkerDatabase(await getStateDatabase()).listChildIds(sessionId)),
  ]);
  const errors = await deleteWorkers(sessionIds);
  if (errors.length > 0) {
    throw new AggregateError(errors, `Unable to clean up workers owned by ${sessionId}.`);
  }
}

/** Remove every live or retained worker owned by a deleted app. */
export async function deleteWorkersForApp(appId: string): Promise<void> {
  const sessionIds = new Set([
    ...getActiveWorkers()
      .filter((worker) => worker.type === "app" && worker.appId === appId)
      .map((worker) => worker.sessionId),
    ...(await new WorkerDatabase(await getStateDatabase()).list({ type: "app", appId })).map(
      (worker) => worker.sessionId,
    ),
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
    const worker =
      (await new WorkerDatabase(await getStateDatabase()).get(sessionId)) ??
      getActiveWorker(sessionId);
    if (worker?.type !== type) return false;
  }
  const errors: unknown[] = [];
  try {
    await cancelWorker(sessionId);
  } catch (error) {
    errors.push(error);
  }
  try {
    await deleteSession(sessionId);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `Unable to cancel or delete worker ${sessionId}.`);
  }
  return true;
}
