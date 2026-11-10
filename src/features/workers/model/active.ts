import type { WorkspaceEvent } from "@workspace/model/events";
import { workerReferencesSession, type Worker } from ".";

/** The active list's transition function for every client. Work ends with the session or app it
 *  belongs to. */
export function reduceActiveWorkers(
  workers: Worker[],
  event: Extract<
    WorkspaceEvent,
    { type: "worker.started" | "worker.finished" | "session.deleted" | "app.deleted" }
  >,
): Worker[] {
  switch (event.type) {
    case "worker.started":
      return workers.some(({ sessionId }) => sessionId === event.worker.sessionId)
        ? workers
        : [...workers, event.worker];
    case "worker.finished":
      return removeWorkers(workers, (worker) => worker.sessionId === event.sessionId);
    case "session.deleted":
      return removeWorkers(workers, (worker) => workerReferencesSession(worker, event.sessionId));
    case "app.deleted":
      return removeWorkers(
        workers,
        (worker) => worker.type === "app" && worker.appId === event.appId,
      );
  }
}

function removeWorkers(workers: Worker[], remove: (worker: Worker) => boolean): Worker[] {
  const remaining = workers.filter((worker) => !remove(worker));
  return remaining.length === workers.length ? workers : remaining;
}
