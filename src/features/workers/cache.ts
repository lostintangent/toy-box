import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCache } from "@workspace/sync";
import { replaceOverlappingRead } from "@/shared/query";
import { workerReferencesSession, type Worker } from "./model";
import { workerQueries } from "./queries";

export default {
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "worker.started":
        queryClient.setQueryData<Worker[]>(workerQueries.activeKey(), (workers) =>
          !workers || workers.some(({ sessionId }) => sessionId === event.worker.sessionId)
            ? workers
            : [...workers, event.worker],
        );
        break;
      case "worker.finished":
        removeWorkers(queryClient, (worker) => worker.sessionId === event.sessionId);
        break;
      // Work ends with the session or app it belongs to.
      case "session.deleted":
        removeWorkers(queryClient, (worker) => workerReferencesSession(worker, event.sessionId));
        break;
      case "app.deleted":
        removeWorkers(
          queryClient,
          (worker) => worker.type === "app" && worker.appId === event.appId,
        );
        break;
      default:
        return;
    }
    replaceOverlappingRead(queryClient, workerQueries.activeKey());
  },
  refresh: invalidateActiveWorkersQuery,
} satisfies WorkspaceCache;

export function invalidateActiveWorkersQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workerQueries.activeKey(), exact: true });
}

function removeWorkers(queryClient: QueryClient, remove: (worker: Worker) => boolean): void {
  queryClient.setQueryData<Worker[]>(workerQueries.activeKey(), (workers) => {
    const remaining = workers?.filter((worker) => !remove(worker));
    return remaining?.length === workers?.length ? workers : remaining;
  });
}
