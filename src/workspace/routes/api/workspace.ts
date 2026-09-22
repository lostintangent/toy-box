import { createFileRoute } from "@tanstack/react-router";
import type { WorkspaceEvent } from "@workspace/model/events";
import { getWorkspaceRevision, subscribeWorkspaceEvents } from "@workspace/server/events";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<WorkspaceEvent>(request, (send) => {
          // Synchronous setup leaves no gap between the revision and subscription.
          send({ type: "workspace.connected", revision: getWorkspaceRevision() });
          return subscribeWorkspaceEvents(send);
        }),
    },
  },
});
