import type { WorkspaceCache } from "@workspace/sync";
import { automationQueries } from "./queries";

export default {
  preload: (queryClient) => queryClient.ensureQueryData(automationQueries.list),
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "automation.upserted":
      case "automation.deleted":
        automationQueries.list.apply(queryClient, event);
        return;
    }
  },
  refresh: automationQueries.list.refresh,
} satisfies WorkspaceCache;
