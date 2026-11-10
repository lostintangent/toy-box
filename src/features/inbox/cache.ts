import type { WorkspaceCache } from "@workspace/sync";
import { inboxQueries } from "./queries";

export default {
  preload: (queryClient) => queryClient.ensureQueryData(inboxQueries.list),
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "inbox.changed":
        void inboxQueries.list.refresh(queryClient);
        return;
      case "session.deleted":
        inboxQueries.list.apply(queryClient, event);
        return;
    }
  },
  refresh: inboxQueries.list.refresh,
} satisfies WorkspaceCache;
