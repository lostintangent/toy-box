import { createFileRoute } from "@tanstack/react-router";
import type { ServerUpdateEvent } from "@/types";
import { subscribeAutomationsUpdates } from "@/functions/automations/events";
import { subscribeSessionsUpdates } from "@/functions/runtime/broadcast";
import { createSseResponse } from "@/routes/api/-lib/sse";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<ServerUpdateEvent>(request, (send) => {
          const unsubscribeSessions = subscribeSessionsUpdates(send);
          const unsubscribeAutomations = subscribeAutomationsUpdates(send);

          return () => {
            unsubscribeSessions();
            unsubscribeAutomations();
          };
        }),
    },
  },
});
