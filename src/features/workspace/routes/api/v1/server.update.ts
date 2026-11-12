import { createFileRoute } from "@tanstack/react-router";
import { updateServer } from "@workspace/server/installation";
import { disableIdleTimeout, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/server/update")({
  server: {
    handlers: {
      POST: ({ request }) => {
        disableIdleTimeout(request);
        return respond("update the server", updateServer);
      },
    },
  },
});
