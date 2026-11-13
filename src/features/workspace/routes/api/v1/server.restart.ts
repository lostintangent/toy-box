import { createFileRoute } from "@tanstack/react-router";
import { restartServer } from "@workspace/server/installation";
import { disableIdleTimeout, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/server/restart")({
  server: {
    handlers: {
      POST: ({ request }) => {
        disableIdleTimeout(request);
        return respond("restart the server", async () => {
          await restartServer();
          return new Response(null, { status: 202 });
        });
      },
    },
  },
});
