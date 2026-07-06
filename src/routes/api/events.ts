import { createFileRoute } from "@tanstack/react-router";
import type { ServerUpdateEvent } from "@/types";
import {
  subscribeAutomationsUpdates,
  subscribeWorkspaceEvents,
} from "@/functions/runtime/broadcast";
import { createSseResponse } from "@/routes/api/-lib/sse";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<ServerUpdateEvent>(request, (send) => {
          const unsubscribeWorkspace = subscribeWorkspaceEvents(send);
          const unsubscribeAutomations = subscribeAutomationsUpdates(send);

          return () => {
            unsubscribeWorkspace();
            unsubscribeAutomations();
          };
        }),
    },
  },
});
