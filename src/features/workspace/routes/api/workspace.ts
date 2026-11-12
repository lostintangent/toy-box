import { createFileRoute } from "@tanstack/react-router";
import type { WorkspaceEvent } from "@workspace/model/events";
import { closeConnection, openConnection } from "@workspace/server/connections";
import { getWorkspaceRevision, subscribeWorkspaceEvents } from "@workspace/server/events";
import { createSseResponse } from "@/shared/server/sse";
import { version } from "../../../../../package.json";

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: ({ request }) =>
        createSseResponse<WorkspaceEvent>(request, (send) => {
          const connection = openConnection();
          // Synchronous setup leaves no gap between the revision and subscription.
          send({
            type: "workspace.connected",
            revision: getWorkspaceRevision(),
            connection,
            version,
          });
          const unsubscribe = subscribeWorkspaceEvents(send);
          return () => {
            unsubscribe();
            closeConnection(connection);
          };
        }),
    },
  },
});
