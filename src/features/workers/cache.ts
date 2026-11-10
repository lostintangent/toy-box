import type { WorkspaceCache } from "@workspace/sync";
import { workerQueries } from "./queries";

export default {
  preload: (queryClient) => queryClient.ensureQueryData(workerQueries.active),
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "worker.started":
      case "worker.finished":
      case "session.deleted":
      case "app.deleted":
        workerQueries.active.apply(queryClient, event);
        return;
    }
  },
  refresh: workerQueries.active.refresh,
} satisfies WorkspaceCache;
