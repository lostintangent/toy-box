import { createFileRoute } from "@tanstack/react-router";
import type { WorkspaceEvent } from "@workspace/model/events";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<WorkspaceEvent>(request, (send) => subscribeWorkspaceEvents(send)),
    },
  },
});
