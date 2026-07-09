import { createFileRoute } from "@tanstack/react-router";
import type { ServerUpdate } from "@/types";
import { subscribeAutomationEvents, subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { createSseResponse } from "@/routes/api/-lib/sse";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<ServerUpdate>(request, (send) => {
          const unsubscribeWorkspace = subscribeWorkspaceEvents((event) => {
            send({ topic: "workspace", event });
          });
          const unsubscribeAutomations = subscribeAutomationEvents((event) => {
            send({ topic: "automation", event });
          });

          return () => {
            unsubscribeWorkspace();
            unsubscribeAutomations();
          };
        }),
    },
  },
});
