import { createFileRoute } from "@tanstack/react-router";
import type { WorkspaceEvent } from "@/types";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { createSseResponse } from "@/routes/api/-lib/sse";

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<WorkspaceEvent>(request, (send) => subscribeWorkspaceEvents(send)),
    },
  },
});
