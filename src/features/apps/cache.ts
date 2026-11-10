import type { WorkspaceCache } from "@workspace/sync";
import { appQueries } from "./queries";

export default {
  preload: (queryClient) => queryClient.ensureQueryData(appQueries.list),
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "app.registered":
      case "app.unregistered":
      case "app.upserted":
      case "app.deleted":
      case "app.share.created":
      case "app.share.deleted":
        appQueries.list.apply(queryClient, event);
        return;
    }
  },
  refresh: appQueries.list.refresh,
} satisfies WorkspaceCache;
